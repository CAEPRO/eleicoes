// ==========================================
// CONFIGURAÇÕES GERAIS
// ==========================================
const SHEET_ELEITORES = 'ELEITORES';
const SHEET_CHAPAS = 'CHAPAS';
const SHEET_VOTOS = 'VOTOS';
const SHEET_CONFIG = 'CONFIGURACOES';
const SHEET_TENTATIVAS = 'TENTATIVAS';

const TEMPO_CODIGO_MINUTOS = 60;
const MAX_TENTATIVAS = 5;
const TEMPO_BLOQUEIO_HORAS = 5;
const TEMPO_TOKEN_MINUTOS = 60;
const REENVIAR_CODIGO_MINUTOS = 1;

// ==========================================
// RATE LIMIT (CacheService — autoexpirante)
// ==========================================
function _rateLimitExceeded(key, max, ttlSeconds) {
    const cache = CacheService.getScriptCache();
    const atual = Number(cache.get(key) || 0);
    if (atual >= max) return true;
    cache.put(key, String(atual + 1), ttlSeconds);
    return false;
}

function _inCooldown(key) {
    return CacheService.getScriptCache().get(key) !== null;
}

function _setCooldown(key, ttlSeconds) {
    CacheService.getScriptCache().put(key, '1', ttlSeconds);
}

// Identificador do cliente (funciona para anônimos — IP + user-agent)
function _getClientKey() {
    try {
        const key = Session.getTemporaryActiveUserKey();
        if (key) return 'c_' + key;
    } catch (e) { /* ignora */ }
    return null;
}

// ==========================================
// doGet — ENTRADA ÚNICA (JSONP)
// ==========================================
function doGet(e) {
    const p = e.parameter;
    const callback = p.callback || 'cb';
    let result;

    try {
        switch (p.action) {
            case 'status':
                result = getStatusEleicao();
                break;
            case 'chapas':
                result = getChapas();
                break;
            case 'verificarMatricula':
                result = verificarMatricula(p.matricula);
                break;
            case 'enviarCodigo':
                result = enviarCodigo(p.matricula);
                break;
            case 'validarCodigo':
                result = validarCodigo(p.matricula, p.codigo);
                break;
            case 'votar':
                result = registrarVoto(p.token, p.opcao);
                break;
            default:
                result = { erro: 'Ação desconhecida.' };
        }
    } catch (err) {
        result = { erro: 'Erro interno: ' + err.message };
    }

    return ContentService
        .createTextOutput(callback + '(' + JSON.stringify(result) + ')')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

// ==========================================
// FUNÇÕES DE APOIO
// ==========================================
function getSheet(name) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
    if (!sheet) throw new Error('Aba não encontrada: ' + name);
    return sheet;
}

function getStatusEleicao() {
    const data = getSheet(SHEET_CONFIG).getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        if (data[i][0] === 'STATUS_ELEICAO') return { status: data[i][1] };
    }
    return { status: 'NAO_INICIADA' };
}

function getChapas() {
    const data = getSheet(SHEET_CHAPAS).getDataRange().getValues();
    const headers = data[0];
    const chapas = [];
    for (let i = 1; i < data.length; i++) {
        const chapa = {};
        headers.forEach((h, idx) => {
            let valor = data[i][idx];
            if (String(h).toUpperCase().startsWith('FOTO_')) {
                valor = converterLinkDrive(valor);
            }
            chapa[h] = valor;
        });
        chapas.push(chapa);
    }
    return { chapas: chapas };
}

function converterLinkDrive(url) {
    if (!url) return '';
    const s = String(url).trim();

    let fileId = null;
    const padroes = [
        /\/d\/([a-zA-Z0-9_-]+)/,
        /[?&]id=([a-zA-Z0-9_-]+)/,
        /\/d\/([a-zA-Z0-9_-]+)\//
    ];
    for (const p of padroes) {
        const m = s.match(p);
        if (m) { fileId = m[1]; break; }
    }

    if (!fileId) return s;
    return 'https://lh3.googleusercontent.com/d/' + fileId;
}

// ==========================================
// ETAPA 1 — VERIFICAÇÃO DE MATRÍCULA
// (mantém nome + emailMascarado para a UI)
// ==========================================
function verificarMatricula(matricula) {
    if (!matricula) return { erro: 'Informe a matrícula.' };

    if (getStatusEleicao().status !== 'ABERTA') {
        return { erro: 'A eleição não está aberta.' };
    }

    // Rate limit por matrícula: 5 tentativas / 10 min
    if (_rateLimitExceeded('rl_verif_m_' + matricula, 5, 600)) {
        return { erro: 'Muitas tentativas. Aguarde alguns minutos.' };
    }

    // Rate limit por cliente: 10 tentativas / 10 min (mitiga enumeração)
    const clientKey = _getClientKey();
    if (clientKey && _rateLimitExceeded('rl_verif_' + clientKey, 10, 600)) {
        return { erro: 'Muitas tentativas. Aguarde alguns minutos.' };
    }

    const data = getSheet(SHEET_ELEITORES).getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        if (String(data[i][1]).trim() === String(matricula).trim()) {
            if (data[i][3] === 'VOTOU') {
                return { erro: 'Esta matrícula já votou.' };
            }
            const email = data[i][2];
            const nome = data[i][0];
            return {
                valido: true,
                nome: nome,
                emailMascarado: String(email).replace(/(.{3}).*(@.*)/, '$1*****$2')
            };
        }
    }
    return { erro: 'Matrícula não encontrada ou aluno inativo.' };
}

// ==========================================
// ETAPA 2 — ENVIO DO CÓDIGO
// ==========================================
function enviarCodigo(matricula) {
    if (!matricula) return { erro: 'Informe a matrícula.' };

    if (getStatusEleicao().status !== 'ABERTA') {
        return { erro: 'A eleição não está aberta.' };
    }

    // Cooldown entre envios para a mesma matrícula
    if (_inCooldown('rl_envio_cd_' + matricula)) {
        return { erro: 'Aguarde ' + REENVIAR_CODIGO_MINUTOS + ' minuto para reenviar o código.' };
    }

    // Máx. 3 envios / 15 min por matrícula (protege a caixa de entrada)
    if (_rateLimitExceeded('rl_envio_m_' + matricula, 3, 900)) {
        return { erro: 'Limite de envios atingido. Tente mais tarde.' };
    }

    // Máx. 10 envios / 15 min por cliente (protege o MailApp)
    const clientKey = _getClientKey();
    if (clientKey && _rateLimitExceeded('rl_envio_' + clientKey, 10, 900)) {
        return { erro: 'Limite de envios atingido. Tente mais tarde.' };
    }

    _setCooldown('rl_envio_cd_' + matricula, REENVIAR_CODIGO_MINUTOS * 60);

    // Busca eleitor
    const eleitores = getSheet(SHEET_ELEITORES).getDataRange().getValues();
    let eleitor = null;
    for (let i = 1; i < eleitores.length; i++) {
        if (String(eleitores[i][1]).trim() === String(matricula).trim()) {
            eleitor = eleitores[i];
            break;
        }
    }
    if (!eleitor) return { erro: 'Matrícula não encontrada.' };

    const emailDestino = eleitor[2];

    // Se já votou, envia e-mail informativo (privado) em vez de código
    if (eleitor[3] === 'VOTOU') {
        try {
            MailApp.sendEmail({
                to: emailDestino,
                subject: 'Urna Eletrônica - Status do seu voto',
                body: 'Você já registrou seu voto nesta eleição.\n\n' +
                    'Não é necessário votar novamente.\n' +
                    'Se você não reconhece esta ação, contate a organização.'
            });
        } catch (err) {
            Logger.log('Falha e-mail informativo: ' + err.message);
        }
        return { sucesso: true };
    }

    // Gera e salva o código
    const sheet = getSheet(SHEET_TENTATIVAS);
    const data = sheet.getDataRange().getValues();
    const agora = new Date();
    const codigo = String(Math.floor(100000 + Math.random() * 900000));
    const expiraEm = new Date(agora.getTime() + TEMPO_CODIGO_MINUTOS * 60000);

    let encontrado = false;
    for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]).trim() === String(matricula).trim()) {
            // Se está bloqueado, nem envia novo código (não dá brecha para reset)
            const bloqueadoAte = data[i][4] ? new Date(data[i][4]) : null;
            if (bloqueadoAte && bloqueadoAte > agora) {
                return { erro: 'Conta temporariamente bloqueada.' };
            }

            // O único ponto que zera TENTATIVAS, se o reenviu foi após o tempo de bloqueio
            if (bloqueadoAte && bloqueadoAte <= agora) {
                sheet.getRange(i + 1, 4).setValue(0); // TENTATIVAS = 0
                sheet.getRange(i + 1, 5).setValue(''); // BLOQUEADO_ATE = ''
            }

            // Atualiza SOMENTE CODIGO (B) e EXPIRA_EM (C) — preserva TENTATIVAS (D)
            sheet.getRange(i + 1, 2, 1, 2).setValues([
                [codigo, expiraEm]
            ]);
            // Invalida token antigo — mas NÃO mexe em BLOQUEADO_ATE
            sheet.getRange(i + 1, 6, 1, 2).clearContent();
            encontrado = true;
            break;
        }
    }
    if (!encontrado) {
        sheet.appendRow([matricula, codigo, expiraEm, 0, '', '', '']);
    }

    try {
        MailApp.sendEmail({
            to: emailDestino,
            subject: 'Código de Acesso - Urna Eletrônica',
            body: 'Seu código de verificação é: ' + codigo +
                '\nEle expira em ' + TEMPO_CODIGO_MINUTOS + ' minutos.'
        });
    } catch (err) {
        Logger.log('Falha ao enviar código: ' + err.message);
        return { erro: 'Não foi possível enviar o código agora. Tente novamente.' };
    }

    return { sucesso: true };
}

// ==========================================
// ETAPA 3 — VALIDAÇÃO DO CÓDIGO
// ==========================================
function validarCodigo(matricula, codigoDigitado) {
    if (!matricula || !codigoDigitado) {
        return { erro: 'Dados incompletos.' };
    }

    // Rate limit por cliente: 15 validações / 10 min
    // (evita DoS de lockout, mas permite várias tentativas legítimas)
    const clientKey = _getClientKey();
    if (clientKey && _rateLimitExceeded('rl_valid_' + clientKey, 15, 600)) {
        return { erro: 'Muitas tentativas. Aguarde alguns minutos.' };
    }

    const sheet = getSheet(SHEET_TENTATIVAS);
    const data = sheet.getDataRange().getValues();
    const agora = new Date();

    for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]).trim() === String(matricula).trim()) {
            const codigoSalvo = String(data[i][1]);
            const expiraEm = new Date(data[i][2]);
            let tentativas = Number(data[i][3]) || 0;
            const bAte = data[i][4] ? new Date(data[i][4]) : null;

            if (bAte && bAte > agora) return { erro: 'Conta temporariamente bloqueada.' };

            // Zera TENTATIVAS
            if (bAte && bAte <= agora) {
                tentativas = 0;
                sheet.getRange(i + 1, 4).setValue(0);
                sheet.getRange(i + 1, 5).setValue('');
            }

            if (agora > expiraEm) return { erro: 'Código expirado. Solicite um novo.' };

            if (codigoSalvo !== String(codigoDigitado)) {
                tentativas++;
                sheet.getRange(i + 1, 4).setValue(tentativas);
                if (tentativas >= MAX_TENTATIVAS) {
                    sheet.getRange(i + 1, 5).setValue(
                        new Date(agora.getTime() + TEMPO_BLOQUEIO_HORAS * 3600000)
                    );
                    return { erro: 'Máximo de tentativas excedido. Bloqueado por ' + TEMPO_BLOQUEIO_HORAS + ' hora.' };
                }
                return { erro: 'Código incorreto. Restam ' + (MAX_TENTATIVAS - tentativas) + ' tentativas.' };
            }

            const token = Utilities.getUuid();
            const tokenExpira = new Date(agora.getTime() + TEMPO_TOKEN_MINUTOS * 60000);
            sheet.getRange(i + 1, 6, 1, 2).setValues([
                [token, tokenExpira]
            ]);
            return { sucesso: true, token: token };
        }
    }
    return { erro: 'Código inválido ou expirado. Solicite um novo.' };
}

// ==========================================
// ETAPA 4 — REGISTRO DO VOTO
// ==========================================
function registrarVoto(token, opcao) {
    const lock = LockService.getScriptLock();
    try {
        lock.waitLock(10000);

        const tentSheet = getSheet(SHEET_TENTATIVAS);
        const tentData = tentSheet.getDataRange().getValues();
        let matricula = null,
            linhaToken = -1;
        for (let i = 1; i < tentData.length; i++) {
            if (tentData[i][5] === token) {
                matricula = tentData[i][0];
                linhaToken = i + 1;
                break;
            }
        }
        if (!matricula) return { erro: 'Token inválido ou já utilizado.' };

        const eleSheet = getSheet(SHEET_ELEITORES);
        const eleData = eleSheet.getDataRange().getValues();
        let linhaEleitor = -1;
        for (let i = 1; i < eleData.length; i++) {
            if (String(eleData[i][1]).trim() === String(matricula).trim()) {
                if (eleData[i][3] === 'VOTOU') return { erro: 'Eleitor já votou.' };
                linhaEleitor = i + 1;
                break;
            }
        }
        if (linhaEleitor === -1) return { erro: 'Eleitor não encontrado.' };

        const agora = new Date();
        const cincoMin = 5 * 60 * 1000;
        const horaArredondada = new Date(Math.floor(agora.getTime() / cincoMin) * cincoMin);

        getSheet(SHEET_VOTOS).appendRow([opcao, horaArredondada]);
        eleSheet.getRange(linhaEleitor, 4).setValue('VOTOU');
        tentSheet.getRange(linhaToken, 6, 1, 2).clearContent();

        return { sucesso: true };
    } finally {
        lock.releaseLock();
    }
}
