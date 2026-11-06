// ============================================
// 1. CONFIGURAÇÃO
// ============================================
const CONFIG = Object.freeze({
    URL_APPS_SCRIPT: 'https://script.google.com/macros/s/AKfycbzpP5IaP01uBut6NKVq4gcUIo3D83fxTzq78CBUPLJnTWJpML-EpX6NTnSY6V5qlZq8/exec',
    MAX_MATRICULA: 20,
    MAX_CODIGO: 6,
    MAX_DIGITOS_CHAPA: 2,
    TIMEOUT_REDE: 15000,
    COOLDOWN_REENVIO_SEG: 60,
    AUTO_RESET_FIM_SEG: 15,
    TAMANHO_TOAST_MS: 3500,
});

// ============================================
// 2. ESTADO GLOBAL
// ============================================
const state = {
    tokenVotacao: null,
    opcaoSelecionada: null,
    chapasCache: [],
    numeroDigitado: '',
    telaAtiva: 'status',
    nomeVotante: '',
    matriculaAtual: '',
    enviando: false,
    cooldownReenvioFim: 0,
    intervalCooldown: null,
    intervalResetFim: null,
};

// ============================================
// 3. MOTOR DE SOM (Web Audio API)
// ============================================
let audioCtx = null;

function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
}

function playTone(freq, durationMs, delayMs = 0) {
    try {
        const ctx = getAudioCtx();
        const t0 = ctx.currentTime + delayMs / 1000;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.001, t0);
        gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + durationMs / 1000);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + durationMs / 1000 + 0.05);
    } catch (_) { /* áudio é opcional — falha silenciosa */ }
}

const somTecla = () => playTone(880, 55);
const somErro = () => playTone(220, 220);
const somConfirma = () => { playTone(660, 90, 0); playTone(990, 250, 90); };
const somFim = () => { playTone(440, 180, 0); playTone(660, 180, 180); playTone(880, 700, 360); };

// ============================================
// 4. CLIENTE JSONP
// ============================================
function jsonpRequest(params) {
    return new Promise((resolve, reject) => {
        const cbName = 'jsonp_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
        const query = new URLSearchParams({ ...params, callback: cbName });
        const script = document.createElement('script');

        const timer = setTimeout(() => {
            cleanup();
            reject(new Error('Tempo esgotado. Verifique sua conexão.'));
        }, CONFIG.TIMEOUT_REDE);

        function cleanup() {
            clearTimeout(timer);
            delete window[cbName];
            if (script.parentNode) script.remove();
        }

        window[cbName] = (data) => { cleanup(); resolve(data); };
        script.onerror = () => { cleanup(); reject(new Error('Falha de rede. Verifique sua conexão.')); };
        script.src = CONFIG.URL_APPS_SCRIPT + '?' + query.toString();
        document.body.appendChild(script);
    });
}

// ============================================
// 5. NAVEGAÇÃO
// ============================================
const telas = {
    status: document.getElementById('tela-status'),
    identificacao: document.getElementById('tela-identificacao'),
    codigo: document.getElementById('tela-codigo'),
    votacao: document.getElementById('tela-votacao'),
    confirmacao: document.getElementById('tela-confirmacao'),
    fim: document.getElementById('tela-fim'),
};

function mostrarTela(nome) {
    Object.values(telas).forEach(t => t.classList.remove('ativa'));
    telas[nome].classList.add('ativa');
    state.telaAtiva = nome;

    // A11y: move foco para o container principal da nova tela
    const container = telas[nome].querySelector('.tela, .status-box, .fim-screen');
    if (container) {
        if (!container.hasAttribute('tabindex')) {
            container.setAttribute('tabindex', '-1');
        }
        requestAnimationFrame(() => container.focus({ preventScroll: true }));
    }
}

// ============================================
// 6. UTILITÁRIOS
// ============================================
function mostrarToast(mensagem, tipo = 'info', duracao = CONFIG.TAMANHO_TOAST_MS) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${tipo}`;
    toast.textContent = mensagem;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-saindo');
        setTimeout(() => toast.remove(), 300);
    }, duracao);
}

function formatarNumeroChapa(numero) {
    return String(numero).padStart(2, '0');
}

function encontrarChapa(numero, chapas) {
    return chapas.find(c => formatarNumeroChapa(c.NUMERO) === numero);
}

function resetarEstado() {
    state.tokenVotacao = null;
    state.opcaoSelecionada = null;
    state.chapasCache = [];
    state.numeroDigitado = '';
    state.nomeVotante = '';
    state.matriculaAtual = '';
    state.enviando = false;
    state.cooldownReenvioFim = 0;

    if (state.intervalCooldown) {
        clearInterval(state.intervalCooldown);
        state.intervalCooldown = null;
    }
    if (state.intervalResetFim) {
        clearInterval(state.intervalResetFim);
        state.intervalResetFim = null;
    }

    const limpar = (id) => {
        const el = document.getElementById(id);
        if (el) el.textContent = '';
    };
    const limparValor = (id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    };

    limparValor('input-matricula');
    limparValor('input-codigo');
    limpar('msg-identificacao');
    limpar('msg-codigo');
    limpar('email-mascarado');
    limpar('nome-votante-codigo');
    limpar('nome-votante-votacao');
    limpar('voto-escolhido');
    limpar('slot-1');
    limpar('slot-2');

    const info = document.getElementById('vote-info');
    if (info) info.innerHTML = '<p class="info-hint">Digite o número da chapa</p>';
}

// ============================================
// 7. INICIALIZAÇÃO / RETRY
// ============================================
async function tentarConexao() {
    const spinner = document.getElementById('spinner');
    const msg = document.getElementById('mensagem-status');
    const btnRetry = document.getElementById('btn-retry-status');

    if (spinner) spinner.style.display = '';
    if (btnRetry) btnRetry.style.display = 'none';
    if (msg) msg.textContent = 'Verificando situação da eleição...';
    mostrarTela('status');

    try {
        const data = await jsonpRequest({ action: 'status' });
        if (spinner) spinner.style.display = 'none';

        if (data.status === 'ABERTA') {
            mostrarTela('identificacao');
        } else if (data.status === 'ENCERRADA') {
            if (msg) msg.textContent = '🛑 A eleição foi encerrada.';
        } else {
            if (msg) msg.textContent = '⏳ A eleição ainda não foi iniciada.';
        }
    } catch (e) {
        if (spinner) spinner.style.display = 'none';
        if (msg) msg.textContent = '⚠ Não foi possível conectar ao servidor.';
        if (btnRetry) btnRetry.style.display = '';
    }
}

(async function init() {
    await tentarConexao();
})();

// ============================================
// 8. ETAPA 1 — VERIFICAÇÃO DE MATRÍCULA
// ============================================
async function verificarMatricula() {
    if (state.enviando) return;

    const matricula = document.getElementById('input-matricula').value.trim();
    const msg = document.getElementById('msg-identificacao');

    if (!matricula) {
        msg.textContent = 'Digite a matrícula.';
        return;
    }

    state.enviando = true;
    msg.textContent = 'Verificando...';
    somTecla();

    try {
        const data = await jsonpRequest({ action: 'verificarMatricula', matricula });
        if (data.erro) {
            somErro();
            msg.textContent = data.erro;
            return;
        }

        state.matriculaAtual = matricula;
        state.nomeVotante = data.nome || '';
        document.getElementById('nome-votante-codigo').textContent = state.nomeVotante;
        document.getElementById('email-mascarado').textContent = data.emailMascarado;
        document.getElementById('input-codigo').value = '';
        document.getElementById('msg-codigo').textContent = '';
        msg.textContent = '';
        mostrarTela('codigo');

        // Dispara o envio do código e inicia cooldown local
        const envio = await jsonpRequest({ action: 'enviarCodigo', matricula });
        if (envio.erro) {
            document.getElementById('msg-codigo').textContent = envio.erro;
        } else {
            iniciarCooldownReenvio(CONFIG.COOLDOWN_REENVIO_SEG);
        }
    } catch (e) {
        somErro();
        msg.textContent = e.message;
    } finally {
        state.enviando = false;
    }
}

function voltarParaIdentificacao() {
    document.getElementById('input-codigo').value = '';
    document.getElementById('msg-codigo').textContent = '';
    state.cooldownReenvioFim = 0;
    if (state.intervalCooldown) {
        clearInterval(state.intervalCooldown);
        state.intervalCooldown = null;
    }
    atualizarBotaoReenvio();
    mostrarTela('identificacao');
}

// ============================================
// 9. REENVIO DE CÓDIGO
// ============================================
function iniciarCooldownReenvio(segundos) {
    state.cooldownReenvioFim = Date.now() + segundos * 1000;
    atualizarBotaoReenvio();

    if (state.intervalCooldown) clearInterval(state.intervalCooldown);
    state.intervalCooldown = setInterval(() => {
        atualizarBotaoReenvio();
        if (Date.now() >= state.cooldownReenvioFim) {
            clearInterval(state.intervalCooldown);
            state.intervalCooldown = null;
        }
    }, 1000);
}

function atualizarBotaoReenvio() {
    const btn = document.getElementById('btn-reenviar');
    if (!btn) return;

    const restante = Math.max(0, Math.ceil((state.cooldownReenvioFim - Date.now()) / 1000));
    if (restante > 0) {
        btn.disabled = true;
        btn.textContent = `Reenviar em ${restante}s`;
    } else {
        btn.disabled = false;
        btn.textContent = 'Reenviar código';
    }
}

async function reenviarCodigo() {
    if (state.enviando) return;

    const restante = Math.max(0, Math.ceil((state.cooldownReenvioFim - Date.now()) / 1000));
    if (restante > 0) return;

    if (!state.matriculaAtual) {
        mostrarToast('Sessão expirada. Volte ao início.', 'erro');
        voltarParaIdentificacao();
        return;
    }

    state.enviando = true;
    iniciarCooldownReenvio(CONFIG.COOLDOWN_REENVIO_SEG);

    try {
        const envio = await jsonpRequest({ action: 'enviarCodigo', matricula: state.matriculaAtual });
        if (envio.erro) {
            document.getElementById('msg-codigo').textContent = envio.erro;
            return;
        }
        document.getElementById('msg-codigo').textContent = '';
        mostrarToast('Novo código enviado ao e-mail cadastrado.', 'success');
    } catch (e) {
        document.getElementById('msg-codigo').textContent = e.message;
        // Erro de rede: permite nova tentativa após 5s
        state.cooldownReenvioFim = Date.now() + 5000;
    } finally {
        state.enviando = false;
        atualizarBotaoReenvio();
    }
}

// ============================================
// 10. ETAPA 3 — VALIDAÇÃO DO CÓDIGO
// ============================================
async function validarCodigo() {
    if (state.enviando) return;

    const matricula = state.matriculaAtual;
    const codigo = document.getElementById('input-codigo').value.trim();
    const msg = document.getElementById('msg-codigo');

    if (codigo.length !== CONFIG.MAX_CODIGO) {
        msg.textContent = `Digite os ${CONFIG.MAX_CODIGO} dígitos.`;
        return;
    }

    state.enviando = true;
    msg.textContent = 'Validando...';
    somTecla();

    try {
        const data = await jsonpRequest({ action: 'validarCodigo', matricula, codigo });
        if (data.erro) {
            somErro();
            msg.textContent = data.erro;
            return;
        }
        state.tokenVotacao = data.token;
        msg.textContent = '';
        await carregarChapas();
        state.numeroDigitado = '';
        atualizarVisor();
        document.getElementById('nome-votante-votacao').textContent = state.nomeVotante;
        mostrarTela('votacao');
    } catch (e) {
        somErro();
        msg.textContent = e.message;
    } finally {
        state.enviando = false;
    }
}

// ============================================
// 11. CHAPAS
// ============================================
async function carregarChapas() {
    const data = await jsonpRequest({ action: 'chapas' });
    state.chapasCache = data.chapas || [];
}

// ============================================
// 12. AÇÕES DE VOTO
// ============================================
function votarBranco() {
    if (state.numeroDigitado.length > 0) return;
    somTecla();
    state.opcaoSelecionada = 'BRANCO';
    document.getElementById('voto-escolhido').textContent = 'VOTO EM BRANCO';
    mostrarTela('confirmacao');
}

function confirmarVotoParcial() {
    if (state.numeroDigitado.length !== CONFIG.MAX_DIGITOS_CHAPA) {
        const info = document.getElementById('vote-info');
        info.innerHTML = `<p class="info-hint info-erro">⚠ Digite os ${CONFIG.MAX_DIGITOS_CHAPA} dígitos da chapa.</p>`;
        somErro();
        return;
    }
    somTecla();
    const chapa = encontrarChapa(state.numeroDigitado, state.chapasCache);
    state.opcaoSelecionada = chapa ? state.numeroDigitado : 'NULO';
    document.getElementById('voto-escolhido').textContent = chapa
        ? `Chapa ${state.numeroDigitado} — ${chapa.PRESIDENTE}`
        : 'VOTO NULO';
    mostrarTela('confirmacao');
}

async function confirmarVotoFinal() {
    if (state.enviando) return;
    state.enviando = true;

    try {
        const data = await jsonpRequest({
            action: 'votar',
            token: state.tokenVotacao,
            opcao: state.opcaoSelecionada,
        });
        if (data.erro) {
            somErro();
            mostrarToast(data.erro, 'erro');
            return;
        }
        somConfirma();
        mostrarTela('fim');
        setTimeout(somFim, 500);
        agendarResetFim();
    } catch (e) {
        somErro();
        mostrarToast('Erro ao registrar voto: ' + e.message, 'erro');
    } finally {
        state.enviando = false;
    }
}

function agendarResetFim() {
    let restante = CONFIG.AUTO_RESET_FIM_SEG;
    const countdown = document.getElementById('fim-countdown');
    if (countdown) countdown.textContent = restante;

    if (state.intervalResetFim) clearInterval(state.intervalResetFim);
    state.intervalResetFim = setInterval(() => {
        restante--;
        if (countdown) countdown.textContent = Math.max(0, restante);
        if (restante <= 0) {
            clearInterval(state.intervalResetFim);
            state.intervalResetFim = null;
            proximoEleitor();
        }
    }, 1000);
}

function proximoEleitor() {
    if (state.intervalResetFim) {
        clearInterval(state.intervalResetFim);
        state.intervalResetFim = null;
    }
    resetarEstado();
    mostrarTela('identificacao');
    mostrarToast('Pronto para o próximo eleitor.', 'info');
}

// ============================================
// 13. VISOR TSE
// ============================================
const CARGOS = [
    { cargo: 'Presidente', nomeKey: 'PRESIDENTE', fotoKey: 'FOTO_PRESIDENTE' },
    { cargo: 'Vice-Presidente', nomeKey: 'VICE', fotoKey: 'FOTO_VICE' },
    { cargo: 'Secretário(a) Geral', nomeKey: 'SECRETARIO', fotoKey: 'FOTO_SECRETARIO' },
    { cargo: 'Diretor(a) Financeiro', nomeKey: 'DIRETOR_FINANCEIRO', fotoKey: 'FOTO_FINANCEIRO' },
    { cargo: 'Diretor(a) de Marketing', nomeKey: 'DIRETOR_MARKETING', fotoKey: 'FOTO_MARKETING' },
    { cargo: 'Diretor(a) de Ensino e Pesquisa', nomeKey: 'DIRETOR_ENSINO', fotoKey: 'FOTO_ENSINO' },
    { cargo: 'Diretor(a) de Eventos', nomeKey: 'DIRETOR_EVENTOS', fotoKey: 'FOTO_EVENTOS' },
];

function montarCardIntegrante(chapa, { cargo, nomeKey, fotoKey }) {
    const nome = chapa[nomeKey];
    if (!nome) return '';

    const foto = chapa[fotoKey];
    const conteudoFoto = foto
        ? `<img src="${foto}" alt="${nome}" onerror="this.parentElement.classList.add('sem-foto')">`
        : '<span class="foto-placeholder">?</span>';

    return `
        <div class="integrante">
            <div class="integrante-foto">${conteudoFoto}</div>
            <div class="integrante-dados">
                <span class="integrante-cargo">${cargo}</span>
                <span class="integrante-nome" title="${nome}">${nome}</span>
            </div>
        </div>`;
}

function montarListaChapas(chapa, numeroDigitado) {
    const cards = CARGOS.map(c => montarCardIntegrante(chapa, c)).join('');
    return `
        <div class="chapa-titulo">CHAPA ${numeroDigitado}</div>
        <div class="chapa-integrantes">${cards}</div>`;
}

function atualizarVisor() {
    const slot1 = document.getElementById('slot-1');
    const slot2 = document.getElementById('slot-2');
    const info = document.getElementById('vote-info');
    const btnBranco = document.querySelector('#tela-votacao [data-action="branco"]');

    slot1.textContent = state.numeroDigitado[0] || '';
    slot2.textContent = state.numeroDigitado[1] || '';
    slot1.classList.toggle('filled', !!state.numeroDigitado[0]);
    slot2.classList.toggle('filled', !!state.numeroDigitado[1]);

    if (btnBranco) btnBranco.disabled = state.numeroDigitado.length > 0;

    if (state.numeroDigitado.length === 0) {
        info.innerHTML = '<p class="info-hint">Digite o número da chapa</p>';
        return;
    }

    if (state.numeroDigitado.length === 1) {
        info.innerHTML = '<p class="info-hint">Aguardando segundo dígito...</p>';
        return;
    }

    const chapa = encontrarChapa(state.numeroDigitado, state.chapasCache);
    info.innerHTML = chapa
        ? montarListaChapas(chapa, state.numeroDigitado)
        : '<div class="chapa-nulo">VOTO NULO</div>';
}

// ============================================
// 14. TECLADO — EVENT DELEGATION
// ============================================
document.addEventListener('click', (e) => {
    const tecla = e.target.closest('.tecla');
    if (!tecla || tecla.disabled) return;

    if (tecla.dataset.num !== undefined) {
        handleDigit(tecla.dataset.num);
    } else if (tecla.dataset.action) {
        handleAction(tecla.dataset.action);
    }
});

function handleDigit(n) {
    if (state.telaAtiva === 'identificacao') {
        const inp = document.getElementById('input-matricula');
        if (inp.value.length < CONFIG.MAX_MATRICULA) {
            inp.value += n;
            somTecla();
        }
    } else if (state.telaAtiva === 'codigo') {
        const inp = document.getElementById('input-codigo');
        if (inp.value.length < CONFIG.MAX_CODIGO) {
            inp.value += n;
            somTecla();
        }
    } else if (state.telaAtiva === 'votacao') {
        if (state.numeroDigitado.length < CONFIG.MAX_DIGITOS_CHAPA) {
            state.numeroDigitado += n;
            somTecla();
            atualizarVisor();
        }
    }
}

// Mapa de ações por tela (composition pattern)
const acoesPorTela = {
    identificacao: {
        corrige: () => {
            document.getElementById('input-matricula').value = '';
            document.getElementById('msg-identificacao').textContent = '';
            somTecla();
        },
        confirma: verificarMatricula,
    },
    codigo: {
        corrige: () => {
            document.getElementById('input-codigo').value = '';
            document.getElementById('msg-codigo').textContent = '';
            somTecla();
        },
        confirma: validarCodigo,
    },
    votacao: {
        corrige: () => {
            state.numeroDigitado = '';
            atualizarVisor();
            somTecla();
        },
        confirma: confirmarVotoParcial,
        branco: votarBranco,
    },
    confirmacao: {
        corrige: () => {
            state.numeroDigitado = '';
            atualizarVisor();
            mostrarTela('votacao');
            somTecla();
        },
        confirma: confirmarVotoFinal,
    },
};

function handleAction(action) {
    const handlers = acoesPorTela[state.telaAtiva];
    if (!handlers) return;
    const fn = handlers[action];
    if (fn) fn();
}

// ============================================
// 15. SANITIZAÇÃO DOS INPUTS
// ============================================
document.getElementById('input-matricula').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, CONFIG.MAX_MATRICULA);
});

document.getElementById('input-codigo').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, CONFIG.MAX_CODIGO);
});

document.getElementById('input-matricula').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); verificarMatricula(); }
});

document.getElementById('input-codigo').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); validarCodigo(); }
});

// ============================================
// 16. BOTÕES ADICIONAIS
// ============================================
document.getElementById('btn-retry-status')?.addEventListener('click', tentarConexao);
document.getElementById('btn-voltar-identificacao')?.addEventListener('click', voltarParaIdentificacao);
document.getElementById('btn-reenviar')?.addEventListener('click', reenviarCodigo);
document.getElementById('btn-proximo-eleitor')?.addEventListener('click', proximoEleitor);