const { useState, useEffect, useRef, useCallback, useMemo } = React;
const e = React.createElement;

// ── Supabase ──────────────────────────────────────────────────────
const SUPABASE_URL = 'https://wtlaxmtsanhzonaiubsh.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Ah7oFW9qXMg4-8U47U5Tag_dZJpQmro';
const SB = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const FN_CHAT = `${SUPABASE_URL}/functions/v1/chat`;


// ── Provedores (todos OpenAI-compatible) ──────────────────────────
const PROVIDERS = {
  groq: {
    id:'groq', name:'Groq', url:'https://api.groq.com/openai/v1/chat/completions',
    keyPrefix:'gsk_', console:'https://console.groq.com/keys',
    desc:'Rápido (500-800 tok/s) · 14.400 req/dia',
  },
  cerebras: {
    id:'cerebras', name:'Cerebras', url:'https://api.cerebras.ai/v1/chat/completions',
    keyPrefix:'csk-', console:'https://cloud.cerebras.ai',
    desc:'1 milhão de tokens/dia · até 2.000 tok/s',
  },
  gemini: {
    id:'gemini', name:'Gemini', url:'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    keyPrefix:'', console:'https://aistudio.google.com/apikey',
    desc:'Google · modelos Flash gratuitos e multimodais',
  },
  openrouter: {
    id:'openrouter', name:'OpenRouter', url:'https://openrouter.ai/api/v1/chat/completions',
    keyPrefix:'sk-or-', console:'https://openrouter.ai/keys',
    desc:'Catálogo com dezenas de modelos :free',
  },
};

// ── Models (cada um aponta para seu provedor) ─────────────────────
const MODELS = [
  // Groq
  { id:'llama-3.3-70b-versatile',                   p:'groq', label:'Llama 3.3 70B — Equilíbrio recomendado ⭐', ctx:128000, max:4096 },
  { id:'openai/gpt-oss-20b',                        p:'groq', label:'GPT-OSS 20B — Rápido e inteligente',        ctx:131072, max:4096 },
  { id:'llama-3.1-8b-instant',                      p:'groq', label:'Llama 3.1 8B — Ultra rápido',               ctx:128000, max:4096 },
  { id:'meta-llama/llama-4-scout-17b-16e-instruct', p:'groq', label:'Llama 4 Scout — Multimodal',                ctx:131072, max:4096 },
  { id:'qwen/qwen3-32b',                            p:'groq', label:'Qwen 3 32B — Raciocínio estruturado',       ctx:131072, max:4096 },
  { id:'openai/gpt-oss-120b',                       p:'groq', label:'GPT-OSS 120B — Máxima inteligência',        ctx:131072, max:2048 },
  { id:'moonshotai/kimi-k2-0905',                   p:'groq', label:'Kimi K2 — Contexto 262k',                   ctx:262144, max:2048 },
  // Cerebras — 1M tokens/dia, ultra rápido
  { id:'llama-3.3-70b',                             p:'cerebras', label:'Llama 3.3 70B (Cerebras) — 1M tok/dia', ctx:65536,  max:8192 },
  { id:'gpt-oss-120b',                              p:'cerebras', label:'GPT-OSS 120B (Cerebras) — alto volume', ctx:65536,  max:8192 },
  { id:'qwen-3-32b',                                p:'cerebras', label:'Qwen 3 32B (Cerebras)',                 ctx:65536,  max:8192 },
  { id:'llama3.1-8b',                               p:'cerebras', label:'Llama 3.1 8B (Cerebras) — veloz',       ctx:32768,  max:8192 },
  // Gemini — grátis, multimodal, qualidade de ponta
  { id:'gemini-3.8-flash',                          p:'gemini', label:'Gemini 3.8 Flash — melhor qualidade ⭐',   ctx:1000000, max:8192 },
  { id:'gemini-2.5-flash',                          p:'gemini', label:'Gemini 2.5 Flash — estável',              ctx:1000000, max:8192 },
  { id:'gemini-2.5-flash-lite',                     p:'gemini', label:'Gemini 2.5 Flash-Lite — econômico',       ctx:1000000, max:8192 },
  // OpenRouter — modelos :free
  { id:'meta-llama/llama-3.3-70b-instruct:free',    p:'openrouter', label:'Llama 3.3 70B (OpenRouter free)',     ctx:128000, max:4096 },
  { id:'deepseek/deepseek-chat-v3.1:free',          p:'openrouter', label:'DeepSeek V3.1 (OpenRouter free)',     ctx:163840, max:4096 },
  { id:'qwen/qwen3-235b-a22b:free',                 p:'openrouter', label:'Qwen 3 235B (OpenRouter free)',       ctx:131072, max:4096 },
];
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

// Cadeia de fallback: se o modelo atual falhar por limite, tenta estes em ordem
const FALLBACK_CHAIN = [
  'gemini-3.8-flash',                       // Gemini — melhor qualidade
  'llama-3.3-70b',                          // Cerebras — 1M tok/dia
  'meta-llama/llama-3.3-70b-instruct:free', // OpenRouter
  'llama-3.3-70b-versatile',                // Groq
  'llama-3.1-8b-instant',                   // Groq rápido
];

const modelInfo = id => MODELS.find(m => m.id === id) || MODELS[0];
const providerOf = id => PROVIDERS[modelInfo(id).p] || PROVIDERS.groq;

// Extrai as chaves do cfg (compatível com a versão antiga que usava cfg.apiKey = Groq)
const cfgKeys = cfg => ({
  groq:       (cfg.keyGroq ?? cfg.apiKey ?? '').trim(),
  cerebras:   (cfg.keyCerebras || '').trim(),
  gemini:     (cfg.keyGemini || '').trim(),
  openrouter: (cfg.keyOpenRouter || '').trim(),
  tavily:     (cfg.keyTavily || '').trim(),
});
const hasAnyKey = cfg => {
  const k = cfgKeys(cfg);
  return [k.groq, k.cerebras, k.gemini, k.openrouter].some(x => x.length > 0);
};

// ── Storage keys ──────────────────────────────────────────────────
const K_CFG     = 'nexus-cfg-v2';
const K_THEME   = 'nexus-theme-v1';

// ── Temas ─────────────────────────────────────────────────────────
const THEMES = [
  { id:'dark',  name:'Noturno',  desc:'Elegância e foco', icon:'🌙', bg:'#0b0c14', accent:'#c8a44a' },
  { id:'light', name:'Editorial',desc:'Leitura clara',    icon:'☀',  bg:'#faf8f3', accent:'#a8863b' },
  { id:'azure', name:'Céu',      desc:'Calma e clareza',  icon:'✦',  bg:'#eef4fb', accent:'#2d5fa0' },
];

// ── Slash commands ────────────────────────────────────────────────
const SLASH_COMMANDS = [
  { cmd:'/ajuda', desc:'Lista todos os comandos', icon:'❓', cat:'sistema' },
  { cmd:'/oficio', desc:'Gera ofício institucional formal', icon:'📄', cat:'acadêmico' },
  { cmd:'/resumo', desc:'Cria resumo acadêmico (ABNT NBR 6028)', icon:'📝', cat:'acadêmico' },
  { cmd:'/revisar', desc:'Revisa texto com normas ABNT', icon:'🔍', cat:'acadêmico' },
  { cmd:'/metodologia', desc:'Sugere metodologia de pesquisa', icon:'🔬', cat:'acadêmico' },
  { cmd:'/cronograma', desc:'Cria cronograma de pós-graduação', icon:'📅', cat:'acadêmico' },
  { cmd:'/banca', desc:'Simula perguntas de banca examinadora', icon:'🎓', cat:'acadêmico' },
  { cmd:'/abnt', desc:'Formata referência bibliográfica ABNT', icon:'📚', cat:'acadêmico' },
  { cmd:'/briefing', desc:'Briefing de reunião de orientação', icon:'📋', cat:'acadêmico' },
  { cmd:'/projeto', desc:'Workflow completo: explorar → projetar → revisar', icon:'🏗', cat:'técnico' },
  { cmd:'/explorar', desc:'Analisa código/arquitetura em profundidade', icon:'🧭', cat:'técnico' },
  { cmd:'/arquitetura', desc:'Desenha arquitetura com 3 abordagens', icon:'📐', cat:'técnico' },
  { cmd:'/revisar-codigo', desc:'Revisa código (bugs, clean code, DRY)', icon:'🧹', cat:'técnico' },
  { cmd:'/explicar', desc:'Explica código trecho por trecho', icon:'💡', cat:'técnico' },
  { cmd:'/testes', desc:'Gera testes unitários para o código', icon:'🧪', cat:'técnico' },
  { cmd:'/commit', desc:'Mensagem de commit + PR description', icon:'💾', cat:'técnico' },
  { cmd:'/relatorio', desc:'Relatório técnico estruturado', icon:'📊', cat:'profissional' },
  { cmd:'/analise', desc:'Análise crítica estruturada', icon:'⚖️', cat:'profissional' },
  { cmd:'/plano', desc:'Plano de ação com prazos e responsáveis', icon:'🎯', cat:'profissional' },
  { cmd:'/parecer', desc:'Parecer técnico fundamentado', icon:'⚖', cat:'profissional' },
  { cmd:'/limpar', desc:'Limpa histórico desta conversa', icon:'🗑', cat:'sistema' },
];

// ── System prompts: DIRETOS E ESTRUTURADOS ────────────────────────
const SYSTEM_PROMPTS = {
  academic:`Você é o Nexus IA, assistente acadêmico para pós-graduação brasileira.

REGRA DE OURO — SEJA DIRETO:
• NUNCA comece com "Ótima pergunta", "Aqui está", "Vou te ajudar", "Com prazer", "Claro" ou similares
• NUNCA termine com "Espero ter ajudado", "Se precisar de mais", "Ficou alguma dúvida"
• Entre DIRETO no conteúdo da resposta
• Zero preâmbulos, zero despedidas — apenas o essencial

ESTRUTURA:
• Use ## para títulos, **negrito** para termos-chave, listas para itens
• Seja substancial mas conciso — cada palavra deve agregar
• Cite normas ABNT quando aplicável (NBR 6023, 6028, 14724, 10520)
• Use tabelas quando for comparação
• Português brasileiro, registro formal acadêmico`,

  institutional:`Você é o Nexus IA, especialista em redação oficial brasileira (Manual de Redação da Presidência da República, 3ª ed.).

REGRA DE OURO — SEJA DIRETO:
• NUNCA comece com "Segue abaixo", "Aqui está", "Vou gerar" ou similares
• ENTREGUE o documento pronto, direto, sem narração
• Zero explicações antes ou depois, salvo se explicitamente solicitado

ESTRUTURA DO DOCUMENTO:
• Ofício: cabeçalho (órgão, nº, local/data) → destinatário → vocativo → corpo numerado → fecho → assinatura
• Use pronomes de tratamento corretos (VEx.ª, VSª)
• Cite fundamentação legal (Lei, Decreto, artigo) quando pertinente
• Linguagem: impessoalidade, formalidade, concisão, clareza, uniformidade`,

  research:`Você é o Nexus IA, assistente de pesquisa científica (metodologia, estatística, redação acadêmica).

REGRA DE OURO — SEJA DIRETO:
• NUNCA comece com "Ótima pergunta", "Vou explicar", "É importante notar"
• Entre DIRETO na metodologia/análise/explicação
• Zero filosofar — vá ao técnico

ESTRUTURA:
• Metodologia: tipo, abordagem, procedimentos, instrumentos, análise — tudo justificado
• Estatística: indique teste, pressupostos, tamanho de efeito
• Revisão sistemática: PRISMA, critérios, bases
• Artigos: IMRAD (Introdução, Métodos, Resultados, Discussão)
• Referências: Creswell, Yin, Gil, Marconi & Lakatos, Minayo`,

  technical:`Você é o Nexus IA em modo técnico — engenheiro de software sênior.

REGRA DE OURO — SEJA DIRETO:
• Zero "Ótima pergunta", "Aqui está", "Vou te mostrar"
• Código PRIMEIRO, explicação breve depois (se necessária)
• Comentários no próprio código, não em parágrafos antes

ESTRUTURA:
• Forneça código FUNCIONAL e completo em blocos \`\`\`linguagem
• Comente partes não-triviais dentro do código
• Aponte armadilhas em bullet points ao final (se houver)
• Sugira testes só se pedido explicitamente
• Considere: performance, segurança, manutenibilidade, SOLID, DRY`,

  public:`Você é o Nexus IA especializado em Administração Pública Federal brasileira.

REGRA DE OURO — SEJA DIRETO:
• Entre direto na fundamentação legal e no ponto
• Zero preâmbulos do tipo "Conforme a legislação vigente"
• Cite artigo, parágrafo, inciso — sempre específico

DOMÍNIOS:
• Licitações: Lei 14.133/2021, IN SEGES/ME 65/2021, IN SEGES 5/2017
• Patrimônio: Decreto 12.785/2025, NBC TSP 07, Lei 4.320/1964, IN SEDAP 205/1988
• Finanças: LRF (LC 101/2000), SIAFI
• Controle: CGU, TCU (indique acórdãos quando relevante)
• Servidores: Lei 8.112/1990

ESTRUTURA DE PARECER:
Relatório → Análise Técnica (fundamentada) → Conclusão → Recomendação`,

  general:`Você é o Nexus IA, assistente generativo versátil.

REGRA DE OURO — SEJA DIRETO:
• NUNCA: "Ótima pergunta", "Vou te ajudar", "Aqui está", "Espero ter ajudado"
• Entre DIRETO no conteúdo — zero preâmbulos, zero despedidas
• A primeira linha deve responder à pergunta

ESTRUTURA:
• Use ## títulos, **negrito**, listas, tabelas quando úteis
• Direto ao ponto mas com estrutura clara
• Exemplos concretos > teoria abstrata
• Português brasileiro`,
};

function expandSlash(text) {
  const l = text.toLowerCase();
  if(l.startsWith('/oficio')){const a=text.slice(7).trim();return`Gere um ofício institucional formal e completo${a?' sobre: '+a:' para solicitação de reunião/parceria'}. Inclua: cabeçalho com número e data, destinatário, assunto, fundamentação legal, desenvolvimento em seções numeradas, conclusão e fecho padrão.`;}
  if(l.startsWith('/resumo')){const a=text.slice(7).trim();return`Elabore um resumo acadêmico estruturado${a?' sobre: '+a:''}. Siga ABNT NBR 6028: objetivos, metodologia, resultados e conclusões. Inclua palavras-chave. 150-500 palavras.`;}
  if(l.startsWith('/revisar-codigo')){const c=text.slice(15).trim();return c?`Revise este código focando em: (1) Bugs e corretude lógica, (2) Simplicidade, DRY, clean code, (3) Conformidade com convenções. Para cada problema: severidade (alta/média/baixa), linha aproximada, solução.\n\nCódigo:\n${c}`:`Pronto para revisar código. Cole o código em bloco \`\`\`linguagem.`;}
  if(l.startsWith('/revisar')){const c=text.slice(8).trim();return c?`Revise este texto acadêmico: erros gramaticais, registro formal, normas ABNT, coesão, coerência.\n\nTexto:\n${c}`:`Cole o texto que deseja revisar.`;}
  if(l.startsWith('/metodologia')){const t=text.slice(12).trim();return`Sugira metodologia de pesquisa científica${t?' para: '+t:''}. Inclua: tipo, abordagem (qual/quant/mista), instrumentos, população, análise. Justifique cada escolha.`;}
  if(l.startsWith('/cronograma')){const i=text.slice(11).trim();return`Crie cronograma detalhado de pós-graduação${i?' com: '+i:' para mestrado de 24 meses'}. Fases: disciplinas, bibliográfica, coleta, qualificação, análise, redação, defesa.`;}
  if(l.startsWith('/banca')){const t=text.slice(6).trim();return`Simule 5 perguntas desafiadoras de banca de mestrado${t?' sobre: '+t:''}. Para cada uma: nível (baixo/médio/alto) e aspecto avaliado.`;}
  if(l.startsWith('/abnt')){const r=text.slice(5).trim();return r?`Formate segundo ABNT NBR 6023:2018: ${r}`:`Informe os dados da obra para formatar segundo ABNT NBR 6023:2018.`;}
  if(l.startsWith('/briefing')){const a=text.slice(9).trim();return`Gere briefing para reunião de orientação${a?' sobre: '+a:''}. Inclua: pauta, pontos de atenção, pendências, próximos passos, perguntas-guia.`;}
  if(l.startsWith('/projeto')){const t=text.slice(8).trim();return`Desenvolva uma feature em 5 fases${t?' para: '+t:''}.\n\n**FASE 1 — Discovery:** perguntas para entender problema e requisitos.\n**FASE 2 — Exploração:** aspectos do sistema a entender.\n**FASE 3 — Perguntas finais:** ambiguidades (edge cases, error handling).\n**FASE 4 — Arquitetura:** 3 abordagens (minimal, clean, pragmática) com trade-offs e recomendação.\n**FASE 5 — Implementação + Revisão:** código limpo + auto-revisão.\n\nComece pela Fase 1.`;}
  if(l.startsWith('/explorar')){const t=text.slice(9).trim();return`Analise em profundidade${t?': '+t:''}. Entregue:\n1. Entry points (arquivo:linha)\n2. Fluxo de execução\n3. Componentes e responsabilidades\n4. Camadas de arquitetura\n5. Dependências\n6. Insights de design\n7. Arquivos essenciais`;}
  if(l.startsWith('/arquitetura')){const t=text.slice(12).trim();return`Desenhe arquitetura${t?' para: '+t:''} com 3 abordagens:\n\n**1. Minimal Changes** — menor mudança, máximo reuso\n**2. Clean Architecture** — manutenibilidade, abstrações\n**3. Pragmatic Balance** — velocidade + qualidade\n\nPara cada: descrição, componentes, prós, contras, trade-offs, complexidade. Finalize com recomendação fundamentada.`;}
  if(l.startsWith('/explicar')){const c=text.slice(9).trim();return c?`Explique trecho por trecho:\n- O que cada bloco faz\n- Por que foi escrito assim\n- Armadilhas\n- Sugestões\n\nCódigo:\n${c}`:`Cole o código que deseja entender.`;}
  if(l.startsWith('/testes')){const c=text.slice(7).trim();return c?`Gere testes unitários: happy path, edge cases, error handling. Use AAA (Arrange-Act-Assert) e nomes descritivos.\n\nCódigo a testar:\n${c}`:`Cole o código que precisa de testes.`;}
  if(l.startsWith('/commit')){const d=text.slice(7).trim();return`Mensagem de commit (Conventional Commits) + descrição de PR completa${d?' para: '+d:''}. PR: O que mudou, Por que, Como testar, Breaking changes.`;}
  if(l.startsWith('/relatorio')){const t=text.slice(10).trim();return`Relatório técnico completo${t?' sobre: '+t:''}. Estrutura: Sumário Executivo, Contextualização, Metodologia, Análise, Resultados, Conclusões, Recomendações. Use tabelas.`;}
  if(l.startsWith('/analise')){const t=text.slice(8).trim();return`Análise crítica estruturada${t?' de: '+t:''}: (1) Contexto, (2) Pontos fortes, (3) Pontos fracos, (4) Oportunidades, (5) Riscos, (6) Recomendações acionáveis.`;}
  if(l.startsWith('/plano')){const t=text.slice(6).trim();return`Plano de ação executável${t?' para: '+t:''}: objetivo SMART, etapas numeradas com prazos, responsáveis, recursos, KPIs, riscos/mitigação. Use tabela.`;}
  if(l.startsWith('/parecer')){const t=text.slice(8).trim();return`Parecer técnico fundamentado${t?' sobre: '+t:''}. Estrutura: I - Relatório, II - Análise Técnica (com fundamentação legal), III - Conclusão, IV - Recomendação. Cite dispositivos.`;}
  return text;
}

function toolsForSlash(text) {
  const l = text.toLowerCase();
  if(l.startsWith('/oficio'))      return [{name:'DocumentGenerator', icon:'📄', args:'<b>type</b>=ofício · <b>format</b>=ABNT'}];
  if(l.startsWith('/revisar-codigo')) return [{name:'CodeReviewer', icon:'🧹', args:'<b>checks</b>=bugs,DRY,conventions'}];
  if(l.startsWith('/revisar'))     return [{name:'AcademicReviewer', icon:'🔍', args:'<b>standard</b>=ABNT'}];
  if(l.startsWith('/resumo'))      return [{name:'SummaryGenerator', icon:'📝', args:'<b>format</b>=NBR-6028'}];
  if(l.startsWith('/metodologia')) return [{name:'MethodologyAdvisor', icon:'🔬', args:'<b>approach</b>=mixed'}];
  if(l.startsWith('/cronograma'))  return [{name:'SchedulePlanner', icon:'📅', args:'<b>type</b>=post-grad'}];
  if(l.startsWith('/banca'))       return [{name:'ExamSimulator', icon:'🎓', args:'<b>questions</b>=5'}];
  if(l.startsWith('/abnt'))        return [{name:'ABNTFormatter', icon:'📚', args:'<b>norm</b>=NBR-6023:2018'}];
  if(l.startsWith('/briefing'))    return [{name:'BriefingGenerator', icon:'📋', args:'<b>type</b>=orientation'}];
  if(l.startsWith('/projeto'))     return [{name:'FeatureDevWorkflow', icon:'🏗', args:'<b>phases</b>=5'}];
  if(l.startsWith('/explorar'))    return [{name:'CodeExplorer', icon:'🧭', args:'<b>depth</b>=full'}];
  if(l.startsWith('/arquitetura')) return [{name:'CodeArchitect', icon:'📐', args:'<b>approaches</b>=3'}];
  if(l.startsWith('/explicar'))    return [{name:'CodeExplainer', icon:'💡', args:'<b>depth</b>=line-by-line'}];
  if(l.startsWith('/testes'))      return [{name:'TestGenerator', icon:'🧪', args:'<b>pattern</b>=AAA'}];
  if(l.startsWith('/commit'))      return [{name:'GitCommitHelper', icon:'💾', args:'<b>convention</b>=conventional'}];
  if(l.startsWith('/relatorio'))   return [{name:'ReportGenerator', icon:'📊', args:'<b>structure</b>=executive'}];
  if(l.startsWith('/analise'))     return [{name:'SWOTAnalyzer', icon:'⚖️', args:'<b>framework</b>=SWOT+'}];
  if(l.startsWith('/plano'))       return [{name:'ActionPlanner', icon:'🎯', args:'<b>method</b>=SMART'}];
  if(l.startsWith('/parecer'))     return [{name:'TechnicalOpinion', icon:'⚖', args:'<b>structure</b>=RAC'}];
  return [];
}

// ── Utils ─────────────────────────────────────────────────────────
function uid(){ return Math.random().toString(36).slice(2)+Date.now().toString(36); }
function fmtDate(ts){ return new Date(ts).toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'}); }
function fmtTime(ts){ return new Date(ts).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}); }
function genTitle(t){ return t.length>50?t.slice(0,47)+'…':t; }
function docType(txt,q){ const s=(q+' '+txt).toLowerCase(); if(/relatório|inventário|diagnóstico/.test(s))return'relatorio'; if(/ofício|rascunho|email|carta/.test(s))return'rascunho'; return'analise'; }
const TYPE_META={relatorio:{label:'Relatório',icon:'📄'},analise:{label:'Análise',icon:'📊'},rascunho:{label:'Rascunho',icon:'📝'}};
const ld=(k,fb)=>{try{const v=localStorage.getItem(k);return v?JSON.parse(v):fb;}catch{return fb;}};
const sv=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));}catch{}};

// ── Theme management ─────────────────────────────────────────────
function applyTheme(theme){
  document.documentElement.classList.add('theme-transition');
  document.documentElement.setAttribute('data-theme', theme);
  sv(K_THEME, theme);
  setTimeout(()=>document.documentElement.classList.remove('theme-transition'), 400);
}

// ═══════════════════════════════════════════════════════════════
// AUTENTICAÇÃO E DADOS — tudo protegido por RLS no banco
// ═══════════════════════════════════════════════════════════════

async function auCadastrar(email, senha, nome){
  const {data, error} = await SB.auth.signUp({
    email: email.trim().toLowerCase(), password: senha,
    options: {data: {nome: nome.trim()}},
  });
  if(error) throw new Error(traduzErroAuth(error.message));
  return data;
}

async function auEntrar(email, senha){
  const {data, error} = await SB.auth.signInWithPassword({
    email: email.trim().toLowerCase(), password: senha,
  });
  if(error) throw new Error(traduzErroAuth(error.message));
  return data;
}

async function auSair(){ await SB.auth.signOut(); }

async function auRecuperar(email){
  const {error} = await SB.auth.resetPasswordForEmail(email.trim().toLowerCase(),
    {redirectTo: location.href});
  if(error) throw new Error(traduzErroAuth(error.message));
}

function traduzErroAuth(m){
  const t = (m||'').toLowerCase();
  if(t.includes('invalid login')) return 'E-mail ou senha incorretos.';
  if(t.includes('email not confirmed')) return 'Confirme seu e-mail antes de entrar — veja a caixa de entrada.';
  if(t.includes('already registered') || t.includes('already been registered')) return 'Já existe conta com esse e-mail.';
  if(t.includes('password') && t.includes('6')) return 'A senha precisa ter ao menos 6 caracteres.';
  if(t.includes('rate limit') || t.includes('too many')) return 'Muitas tentativas. Aguarde um minuto.';
  if(t.includes('invalid email')) return 'E-mail inválido.';
  return m;
}

// ── Perfil e cota ────────────────────────────────────────────────
async function dbPerfil(){
  const {data} = await SB.from('perfis').select('*').maybeSingle();
  return data;
}

async function dbConsumoHoje(uid){
  const hoje = new Date().toISOString().slice(0,10);
  const {data} = await SB.from('consumo').select('mensagens, tokens')
    .eq('user_id', uid).eq('dia', hoje).maybeSingle();
  return data || {mensagens:0, tokens:0};
}

// ── Conversas ────────────────────────────────────────────────────
const cv_de = r => ({id:r.id, title:r.titulo, messages:r.mensagens||[],
  model:r.modelo, mode:r.modo,
  createdAt:new Date(r.criado_em).getTime(), updatedAt:new Date(r.alterado_em).getTime()});

async function dbConversas(){
  const {data} = await SB.from('conversas').select('*')
    .order('alterado_em', {ascending:false}).limit(200);
  return (data||[]).map(cv_de);
}
async function dbSalvarConversa(c, uid){
  await SB.from('conversas').upsert({
    id:c.id, user_id:uid, titulo:c.title, mensagens:c.messages||[],
    modelo:c.model||null, modo:c.mode||null,
    criado_em:new Date(c.createdAt||Date.now()).toISOString(),
    alterado_em:new Date(c.updatedAt||Date.now()).toISOString(),
  });
}
async function dbApagarConversa(id){ await SB.from('conversas').delete().eq('id', id); }

// ── Documentos ───────────────────────────────────────────────────
const dc_de = r => ({id:r.id, name:r.nome, content:r.conteudo, type:r.tipo,
  createdAt:new Date(r.criado_em).getTime()});

async function dbDocumentos(){
  const {data} = await SB.from('documentos').select('*')
    .order('criado_em', {ascending:false}).limit(300);
  return (data||[]).map(dc_de);
}
async function dbSalvarDocumento(d, uid){
  await SB.from('documentos').upsert({
    id:d.id, user_id:uid, nome:d.name, conteudo:d.content||'', tipo:d.type||'analise',
    criado_em:new Date(d.createdAt||Date.now()).toISOString(),
  });
}
async function dbApagarDocumento(id){ await SB.from('documentos').delete().eq('id', id); }

// ── Memórias ─────────────────────────────────────────────────────
async function dbMemorias(){
  const {data} = await SB.from('memorias').select('*')
    .order('criado_em', {ascending:false}).limit(60);
  return (data||[]).map(r=>({id:r.id, content:r.conteudo, createdAt:new Date(r.criado_em).getTime()}));
}
async function dbSalvarMemoria(m, uid){
  await SB.from('memorias').upsert({id:m.id, user_id:uid, conteudo:m.content,
    criado_em:new Date(m.createdAt||Date.now()).toISOString()});
}
async function dbApagarMemoria(id){ await SB.from('memorias').delete().eq('id', id); }

// ── Preferências ─────────────────────────────────────────────────
async function dbPreferencias(){
  const {data} = await SB.from('preferencias').select('*').maybeSingle();
  if(!data) return null;
  return {
    model:data.modelo, mode:data.modo||'academic', systemPrompt:data.prompt_sistema||'',
    autonomous:data.autonomo !== false,
    keyGroq:data.chave_groq||'', keyCerebras:data.chave_cerebras||'',
    keyGemini:data.chave_gemini||'', keyOpenRouter:data.chave_openrouter||'',
  };
}
async function dbSalvarPreferencias(uid, cfg){
  await SB.from('preferencias').upsert({
    user_id:uid, modelo:cfg.model||null, modo:cfg.mode||'academic',
    prompt_sistema:cfg.systemPrompt||'', autonomo: cfg.autonomous !== false,
    chave_groq:(cfg.keyGroq||'').trim(), chave_cerebras:(cfg.keyCerebras||'').trim(),
    chave_gemini:(cfg.keyGemini||'').trim(), chave_openrouter:(cfg.keyOpenRouter||'').trim(),
    alterado_em:new Date().toISOString(),
  });
}

// ── Admin ────────────────────────────────────────────────────────
async function dbListarPerfis(){
  const {data} = await SB.from('perfis').select('*').order('criado_em', {ascending:false});
  return data || [];
}
async function dbAtualizarPerfil(id, campos){
  await SB.from('perfis').update(campos).eq('id', id);
}
async function dbConsumoGeral(){
  const hoje = new Date().toISOString().slice(0,10);
  const {data} = await SB.from('consumo').select('user_id, mensagens, tokens').eq('dia', hoje);
  const mapa = {};
  (data||[]).forEach(r => mapa[r.user_id] = r);
  return mapa;
}

// ── Chamada à IA via Edge Function ───────────────────────────────
// A chave nunca passa pelo navegador. A cota é checada no servidor.
async function chamarIA({model, messages, system, tools}, onChunk){
  const {data:{session}} = await SB.auth.getSession();
  if(!session) throw new Error('Sessão expirada. Entre novamente.');

  const res = await fetch(FN_CHAT, {
    method:'POST',
    headers:{'Content-Type':'application/json', 'Authorization':`Bearer ${session.access_token}`},
    body: JSON.stringify({model, messages, system, tools}),
  });

  if(!res.ok){
    let d = {};
    try{ d = await res.json(); }catch{}
    const err = new Error(d.mensagem || d.erro || `Erro ${res.status}`);
    err.tipo = d.erro;
    err.cota = {usadas:d.usadas, limite:d.limite};
    throw err;
  }

  const modeloUsado = res.headers.get('X-Nexus-Modelo') || model;
  const reader = res.body.getReader();
  const dec = new TextDecoder('utf-8');
  let content = '', buf = '';
  const calls = {};

  while(true){
    const {done, value} = await reader.read();
    buf += dec.decode(value || new Uint8Array(), {stream:!done});
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for(const raw of lines){
      const line = raw.trim();
      if(!line || !line.startsWith('data: ')) continue;
      const d = line.slice(6);
      if(d === '[DONE]') continue;
      try{
        const delta = JSON.parse(d).choices?.[0]?.delta;
        if(!delta) continue;
        if(delta.content){ content += delta.content; if(onChunk) onChunk(content); }
        for(const tc of (delta.tool_calls || [])){
          const i = tc.index ?? 0;
          calls[i] = calls[i] || {id:'', name:'', args:''};
          if(tc.id) calls[i].id = tc.id;
          if(tc.function?.name) calls[i].name = tc.function.name;
          if(tc.function?.arguments) calls[i].args += tc.function.arguments;
        }
      }catch{}
    }
    if(done) break;
  }
  return {content, toolCalls:Object.values(calls).filter(c=>c.name), modeloUsado};
}


// ── Erros de limite que disparam o failover ──────────────────────
function isLimitError(msg){
  const m = (msg||'').toLowerCase();
  return m.includes('too large') || m.includes('tpm') || m.includes('tokens per minute')
      || m.includes('rate limit') || m.includes('rate_limit') || m.includes('429')
      || m.includes('quota') || m.includes('capacity') || m.includes('overloaded');
}
function isAuthError(msg){
  const m = (msg||'').toLowerCase();
  return m.includes('invalid api key') || m.includes('unauthorized') || m.includes('401')
      || m.includes('no auth') || m.includes('invalid_api_key');
}

// ═══════════════════════════════════════════════════════════════
// LEITURA DE ARQUIVOS — tudo no navegador, nada sai para servidor
// ═══════════════════════════════════════════════════════════════
const MAX_FILE_MB    = 25;
const MAX_CHARS_FILE = 60000;   // ~15k tokens por arquivo
const MAX_PDF_PAGES  = 60;

const TEXT_EXT = ['txt','md','markdown','csv','tsv','json','xml','html','htm','log',
                  'js','ts','jsx','tsx','py','sql','sh','yml','yaml','css','java','c','cpp','go','rb','php'];

function fmtBytes(b){
  if(b < 1024) return b + ' B';
  if(b < 1048576) return (b/1024).toFixed(0) + ' KB';
  return (b/1048576).toFixed(1) + ' MB';
}

function fileIcon(ext){
  if(ext === 'pdf') return '📕';
  if(['docx','doc'].includes(ext)) return '📘';
  if(['xlsx','xls','csv','tsv'].includes(ext)) return '📗';
  if(['png','jpg','jpeg','webp','gif'].includes(ext)) return '🖼';
  return '📄';
}

async function extractFile(file){
  const ext = (file.name.split('.').pop() || '').toLowerCase();

  if(file.size > MAX_FILE_MB * 1048576)
    throw new Error(`Arquivo maior que ${MAX_FILE_MB} MB`);

  // Texto simples e código
  if(TEXT_EXT.includes(ext)) return (await file.text()).slice(0, MAX_CHARS_FILE);

  // PDF
  if(ext === 'pdf'){
    if(!window.pdfjsLib) throw new Error('Leitor de PDF ainda carregando — tente de novo em 2s');
    const buf = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({data:buf}).promise;
    const pages = Math.min(pdf.numPages, MAX_PDF_PAGES);
    let out = '';
    for(let i = 1; i <= pages; i++){
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      out += tc.items.map(it => it.str).join(' ') + '\n\n';
      if(out.length > MAX_CHARS_FILE) break;
    }
    if(pdf.numPages > pages) out += `\n[… documento tem ${pdf.numPages} páginas; lidas as ${pages} primeiras]`;
    if(!out.trim()) throw new Error('PDF sem texto selecionável (provavelmente digitalizado). Converta com OCR antes.');
    return out.slice(0, MAX_CHARS_FILE);
  }

  // Word
  if(ext === 'docx'){
    if(!window.mammoth) throw new Error('Leitor de Word ainda carregando — tente de novo em 2s');
    const buf = await file.arrayBuffer();
    const r = await window.mammoth.extractRawText({arrayBuffer: buf});
    return (r.value || '').slice(0, MAX_CHARS_FILE);
  }
  if(ext === 'doc') throw new Error('Formato .doc antigo não suportado — salve como .docx');

  // Planilhas
  if(['xlsx','xlsm','xls'].includes(ext)){
    if(!window.XLSX) throw new Error('Leitor de planilha ainda carregando — tente de novo em 2s');
    const buf = await file.arrayBuffer();
    const wb = window.XLSX.read(buf, {type:'array'});
    let out = '';
    for(const sn of wb.SheetNames){
      out += `\n### Planilha: ${sn}\n` + window.XLSX.utils.sheet_to_csv(wb.Sheets[sn]) + '\n';
      if(out.length > MAX_CHARS_FILE) break;
    }
    return out.slice(0, MAX_CHARS_FILE);
  }

  throw new Error(`Formato .${ext} não suportado. Use PDF, DOCX, XLSX, CSV, TXT ou código.`);
}


// ═══════════════════════════════════════════════════════════════
// MODO AUTÔNOMO — ferramentas que a IA decide usar sozinha
// ═══════════════════════════════════════════════════════════════
const MAX_AGENT_STEPS = 5;

const TOOL_DEFS = [
  { type:'function', function:{
      name:'buscar_web',
      description:'Pesquisa na internet por informação atual: legislação, acórdãos do TCU, notícias, dados recentes, qualquer coisa posterior ao treinamento. Use sempre que a resposta depender de fato atual ou verificável.',
      parameters:{ type:'object', properties:{
        consulta:{type:'string', description:'Termos de busca em português'},
      }, required:['consulta'] },
  }},
  { type:'function', function:{
      name:'ler_pagina',
      description:'Abre uma URL e lê o conteúdo completo em texto. Use para aprofundar num resultado de busca ou quando o usuário fornecer um link.',
      parameters:{ type:'object', properties:{
        url:{type:'string', description:'URL completa, começando com https://'},
      }, required:['url'] },
  }},
  { type:'function', function:{
      name:'calcular',
      description:'Avalia expressão matemática com precisão. Use para somas, percentuais, depreciação, projeções — nunca calcule de cabeça.',
      parameters:{ type:'object', properties:{
        expressao:{type:'string', description:'Ex: 1540.75 * 12 * 0.1 ou Math.sqrt(2)'},
      }, required:['expressao'] },
  }},
  { type:'function', function:{
      name:'data_hora',
      description:'Retorna a data e hora atuais no fuso de Brasília. Use antes de calcular prazos, vencimentos ou qualquer coisa relativa a hoje.',
      parameters:{ type:'object', properties:{} },
  }},
  { type:'function', function:{
      name:'lembrar',
      description:'Guarda permanentemente um fato sobre o usuário ou o trabalho dele (cargo, setor, projeto em andamento, preferência de formato). Só use para informação duradoura que ajudará em conversas futuras.',
      parameters:{ type:'object', properties:{
        fato:{type:'string', description:'O fato, em uma frase curta e objetiva'},
      }, required:['fato'] },
  }},
];

const TOOL_META = {
  buscar_web: {icon:'🔍', label:'Busca na web'},
  ler_pagina: {icon:'📖', label:'Leitura de página'},
  calcular:   {icon:'🧮', label:'Cálculo'},
  data_hora:  {icon:'🕐', label:'Data e hora'},
  lembrar:    {icon:'🧠', label:'Memória'},
};

// Avaliação matemática restrita — só números, operadores e Math.*
function safeCalc(expr){
  const clean = String(expr).replace(/Math\.\w+/g, 'M');
  if(!/^[\d\s+\-*/().,%M]+$/.test(clean)) throw new Error('Expressão contém termos não permitidos');
  const fn = new Function('Math', `"use strict"; return (${expr});`);
  const r = fn(Math);
  if(typeof r !== 'number' || !isFinite(r)) throw new Error('Resultado inválido');
  return r;
}

async function runTool(name, args, ctx){
  if(name === 'data_hora'){
    const d = new Date();
    return d.toLocaleString('pt-BR', {timeZone:'America/Sao_Paulo', dateStyle:'full', timeStyle:'short'});
  }

  if(name === 'calcular'){
    return `${args.expressao} = ${safeCalc(args.expressao)}`;
  }

  if(name === 'lembrar'){
    if(!ctx.onRemember) return 'Memória indisponível nesta sessão.';
    await ctx.onRemember(args.fato);
    return `Memorizado: ${args.fato}`;
  }

  if(name === 'ler_pagina'){
    const url = String(args.url||'').trim();
    if(!/^https?:\/\//i.test(url)) throw new Error('URL inválida');
    const r = await fetch('https://r.jina.ai/' + url, {headers:{'Accept':'text/plain'}});
    if(!r.ok) throw new Error(`Não foi possível abrir a página (${r.status})`);
    const txt = await r.text();
    return txt.slice(0, 20000);
  }

  if(name === 'buscar_web'){
    const key = (ctx.keys?.tavily || '').trim();
    if(!key) return 'Busca na web indisponível: configure a chave do Tavily em Configurações para habilitar.';
    const r = await fetch('https://api.tavily.com/search', {
      method:'POST',
      headers:{'Content-Type':'application/json', 'Authorization':`Bearer ${key}`},
      body: JSON.stringify({query:args.consulta, max_results:5, search_depth:'basic', include_answer:true}),
    });
    if(!r.ok) throw new Error(`Busca falhou (${r.status})`);
    const d = await r.json();
    let out = d.answer ? `Resumo: ${d.answer}\n\n` : '';
    out += (d.results||[]).map((x,i)=>`[${i+1}] ${x.title}\n${x.url}\n${(x.content||'').slice(0,700)}`).join('\n\n');
    return out || 'Nenhum resultado encontrado.';
  }

  throw new Error(`Ferramenta desconhecida: ${name}`);
}

// ── Loop agêntico: a IA decide, executa, lê o resultado e segue ──
async function runAgent(model, msgs, sys, ctx, onChunk, onTool, onSwitch){
  const supportsTools = modelInfo(model).tools !== false;
  const tools = (ctx.autonomous && supportsTools) ? TOOL_DEFS : null;
  const convo = msgs.map(m => ({role:m.role, content:m.content}));
  let before = '';

  for(let step = 0; step < MAX_AGENT_STEPS; step++){
    const result = await chamarIA(
      {model, messages:convo, system:sys, tools},
      partial => onChunk(before + partial));

    const {content, toolCalls, modeloUsado} = result;
    if(onSwitch && modeloUsado && modeloUsado !== model){
      onSwitch(modeloUsado, {name: (PROVIDERS[modelInfo(modeloUsado).p]||{}).name || modeloUsado});
    }

    if(!toolCalls.length) return before + content;

    before += content ? content + '\n\n' : '';
    convo.push({role:'assistant', content: content || null, tool_calls: toolCalls.map(c=>({
      id:c.id, type:'function', function:{name:c.name, arguments:c.args},
    }))});

    for(const c of toolCalls){
      let parsed = {};
      try{ parsed = JSON.parse(c.args || '{}'); }catch{}
      if(onTool) onTool({name:c.name, args:parsed, done:false});
      let out;
      try{ out = await runTool(c.name, parsed, ctx); }
      catch(err){ out = `Erro ao executar: ${err.message}`; }
      if(onTool) onTool({name:c.name, args:parsed, done:true});
      convo.push({role:'tool', tool_call_id:c.id, content:String(out).slice(0, 24000)});
    }
  }

  return before + '\n\n_(limite de etapas automáticas atingido)_';
}

// ── CSS var helper ────────────────────────────────────────────────
const v = (name) => `var(--${name})`;

// ── Markdown ──────────────────────────────────────────────────────
function Md({content}){
  const html = useMemo(()=>window.marked ? window.marked.parse(content||'') : (content||'').replace(/\n/g,'<br>'), [content]);
  return e('div', {className:'prose', dangerouslySetInnerHTML:{__html:html}});
}

// ── Theme-aware common styles (via CSS vars) ─────────────────────
const T = {
  btnPrimary: {
    padding:'12px 0', width:'100%', borderRadius:10, border:'none', cursor:'pointer',
    background:`linear-gradient(135deg, ${v('accent-l')}, ${v('accent')}, ${v('accent-deep')})`,
    color:'#fff', fontFamily:"var(--sans)", fontSize:13, fontWeight:700, letterSpacing:'0.4px',
    transition:'all 0.2s', boxShadow:`0 8px 24px ${v('accent-glow')}`,
  },
  input: {
    width:'100%', background:v('surface'), border:`1px solid ${v('border')}`, borderRadius:10,
    padding:'11px 14px', color:v('text'), fontFamily:"var(--sans)",
    fontSize:13.5, outline:'none', transition:'border-color 0.2s, box-shadow 0.2s',
  },
  label: {
    fontFamily:"var(--sans)", fontSize:10, fontWeight:700, color:v('muted'),
    display:'block', marginBottom:7, textTransform:'uppercase', letterSpacing:'1.2px',
  },
  sectionCard: {
    marginBottom:22, padding:22, background:v('card'),
    border:`1px solid ${v('border')}`, borderRadius:14,
    boxShadow:`0 2px 8px ${v('shadow')}`,
  },
  sectionTitle: {
    fontFamily:"var(--display)", fontSize:19, fontWeight:700, color:v('text'),
    marginBottom:16, display:'flex', alignItems:'center', gap:10, letterSpacing:'-0.3px',
  },
};

// ═══════════════════════════════════════════════════════════════
// THEME SWITCHER COMPONENT
// ═══════════════════════════════════════════════════════════════
function ThemeSwitcher({currentTheme, onChange, compact}){
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(()=>{
    const handler = ev=>{ if(ref.current && !ref.current.contains(ev.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return ()=>document.removeEventListener('mousedown', handler);
  },[]);

  const current = THEMES.find(t=>t.id===currentTheme) || THEMES[0];

  return e('div', {ref, style:{position:'relative'}},
    e('button', {
      onClick:()=>setOpen(o=>!o),
      style:{
        display:'flex', alignItems:'center', gap:7,
        padding: compact?'6px 10px':'8px 13px',
        background:v('elevated'), border:`1px solid ${v('border')}`,
        borderRadius:9, cursor:'pointer', color:v('text'),
        fontSize:compact?11:12, fontWeight:600, fontFamily:"var(--sans)",
        transition:'all 0.15s',
      },
      onMouseEnter:ev=>{ev.currentTarget.style.borderColor=`var(--accent)`; ev.currentTarget.style.color=v('accent');},
      onMouseLeave:ev=>{ev.currentTarget.style.borderColor=v('border'); ev.currentTarget.style.color=v('text');}
    },
      e('span', {style:{fontSize:compact?13:15}}, current.icon),
      !compact && e('span', null, current.name),
      e('span', {style:{fontSize:9, color:v('muted'), marginLeft:2}}, '▾'),
    ),
    open && e('div', {
      style:{
        position:'absolute', top:'calc(100% + 6px)', right:0,
        background:v('card'), border:`1px solid ${v('border')}`, borderRadius:11,
        padding:6, minWidth:210, zIndex:100,
        boxShadow:`0 12px 32px ${v('shadow')}`,
        animation:'fadeUp 0.18s ease',
      },
    },
      e('div', {style:{fontSize:9, fontWeight:700, color:v('muted'), padding:'5px 11px 7px', letterSpacing:'1.2px', textTransform:'uppercase'}}, 'Tema visual'),
      THEMES.map(t=>e('div', {
        key:t.id, onClick:()=>{onChange(t.id); setOpen(false);},
        style:{
          display:'flex', alignItems:'center', gap:11, padding:'9px 11px',
          borderRadius:8, cursor:'pointer', transition:'background 0.12s',
          background: t.id===currentTheme ? v('accent-dim') : 'transparent',
        },
        onMouseEnter:ev=>{if(t.id!==currentTheme) ev.currentTarget.style.background = v('elevated');},
        onMouseLeave:ev=>{if(t.id!==currentTheme) ev.currentTarget.style.background = 'transparent';},
      },
        e('div', {style:{width:28, height:28, borderRadius:7, background:t.bg, border:`2px solid ${t.accent}`, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:13}}, t.icon),
        e('div', {style:{flex:1, minWidth:0}},
          e('div', {style:{fontSize:12.5, fontWeight:600, color: t.id===currentTheme ? v('accent') : v('text'), fontFamily:"var(--sans)"}}, t.name),
          e('div', {style:{fontSize:10, color:v('muted'), fontFamily:"var(--sans)"}}, t.desc),
        ),
        t.id===currentTheme && e('span', {style:{color:v('accent'), fontSize:13}}, '✓'),
      ))
    )
  );
}

// ═══════════════════════════════════════════════════════════════
// LOGIN SCREEN
// ═══════════════════════════════════════════════════════════════
function LoginScreen({onLogin, theme, onChangeTheme}){
  const [mode, setMode] = useState('login');   // login | cadastro | recuperar
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [nome, setNome] = useState('');
  const [err, setErr] = useState('');
  const [aviso, setAviso] = useState('');
  const [loading, setLoading] = useState(false);

  const entrar = async () => {
    if(!email || !senha){ setErr('Preencha e-mail e senha.'); return; }
    setLoading(true); setErr(''); setAviso('');
    try{
      const {user} = await auEntrar(email, senha);
      onLogin(user);
    }catch(e){ setErr(e.message); }
    setLoading(false);
  };

  const cadastrar = async () => {
    if(!nome || !email || !senha){ setErr('Preencha todos os campos.'); return; }
    if(senha.length < 6){ setErr('A senha precisa ter ao menos 6 caracteres.'); return; }
    setLoading(true); setErr(''); setAviso('');
    try{
      const {user, session} = await auCadastrar(email, senha, nome);
      if(session){ onLogin(user); }
      else{
        setAviso('Conta criada. Enviamos um link de confirmação para o seu e-mail — clique nele e volte aqui para entrar.');
        setMode('login'); setSenha('');
      }
    }catch(e){ setErr(e.message); }
    setLoading(false);
  };

  const recuperar = async () => {
    if(!email){ setErr('Informe seu e-mail.'); return; }
    setLoading(true); setErr(''); setAviso('');
    try{
      await auRecuperar(email);
      setAviso('Se existir conta com esse e-mail, enviamos um link para redefinir a senha.');
      setMode('login');
    }catch(e){ setErr(e.message); }
    setLoading(false);
  };

  const enviar = mode==='login' ? entrar : mode==='cadastro' ? cadastrar : recuperar;

  return e('div', {style:{minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', padding:24, position:'relative', overflow:'hidden'}},
    e('div', {style:{position:'absolute', top:20, right:20, zIndex:10}},
      e(ThemeSwitcher, {currentTheme:theme, onChange:onChangeTheme}),
    ),

    e('div', {style:{width:'100%', maxWidth:440, background:v('card'), border:`1px solid ${v('border')}`, borderRadius:20, padding:'46px 38px', boxShadow:`0 28px 72px ${v('shadow')}`, animation:'fadeUp 0.4s ease'}},

      e('div', {style:{textAlign:'center', marginBottom:34}},
        e('div', {style:{fontFamily:"var(--display)", fontSize:44, fontWeight:700, color:v('accent'), letterSpacing:'-1.2px', lineHeight:1}}, 'Nexus IA'),
        e('div', {style:{fontFamily:"var(--sans)", fontSize:11, color:v('muted'), marginTop:8, letterSpacing:'2px', textTransform:'uppercase', fontWeight:500}}, 'Assistente Generativo Inteligente'),
        e('div', {style:{width:40, height:2, background:`linear-gradient(90deg, transparent, ${v('accent')}, transparent)`, margin:'18px auto 0'}}),
      ),

      mode !== 'recuperar' && e('div', {style:{display:'flex', gap:3, padding:3, background:v('surface'), border:`1px solid ${v('border')}`, borderRadius:10, marginBottom:22}},
        ['login','cadastro'].map(m => e('button', {key:m,
          onClick:()=>{setMode(m); setErr(''); setAviso('');},
          style:{flex:1, padding:'9px', borderRadius:8, border:'none', cursor:'pointer',
            background: mode===m ? v('accent-dim') : 'transparent',
            color: mode===m ? v('accent') : v('muted'),
            fontSize:12.5, fontWeight:600, fontFamily:"var(--sans)", transition:'all 0.15s'}},
          {login:'Entrar', cadastro:'Criar conta'}[m]))
      ),

      mode === 'recuperar' && e('div', {style:{marginBottom:20, fontSize:13, color:v('text-s'), fontFamily:"var(--sans)", lineHeight:1.7, textAlign:'center'}},
        'Informe seu e-mail e enviaremos um link para criar uma nova senha.'),

      mode === 'cadastro' && e('div', {style:{marginBottom:14}},
        e('label', {style:T.label}, 'Seu nome'),
        e('input', {value:nome, onChange:ev=>setNome(ev.target.value), placeholder:'Como quer ser chamado', style:T.input,
          onFocus:ev=>ev.target.style.borderColor=v('accent'), onBlur:ev=>ev.target.style.borderColor=v('border')}),
      ),

      e('div', {style:{marginBottom:14}},
        e('label', {style:T.label}, 'E-mail'),
        e('input', {type:'email', value:email, onChange:ev=>setEmail(ev.target.value), placeholder:'voce@email.com', autoFocus:true,
          onKeyDown:ev=>{if(ev.key==='Enter' && mode!=='cadastro') enviar();}, style:T.input,
          onFocus:ev=>ev.target.style.borderColor=v('accent'), onBlur:ev=>ev.target.style.borderColor=v('border')}),
      ),

      mode !== 'recuperar' && e('div', {style:{marginBottom:18}},
        e('label', {style:T.label}, 'Senha'),
        e('input', {type:'password', value:senha, onChange:ev=>setSenha(ev.target.value), placeholder:'••••••••',
          onKeyDown:ev=>{if(ev.key==='Enter') enviar();}, style:T.input,
          onFocus:ev=>ev.target.style.borderColor=v('accent'), onBlur:ev=>ev.target.style.borderColor=v('border')}),
        mode==='cadastro' && e('div', {style:{fontSize:11, color:v('muted'), marginTop:5, fontFamily:"var(--sans)"}}, 'Mínimo 6 caracteres'),
      ),

      err && e('div', {style:{marginBottom:14, padding:'10px 14px', background:v('red-dim'), border:`1px solid ${v('red')}40`, borderRadius:9, fontFamily:"var(--sans)", fontSize:12, color:v('red'), lineHeight:1.6}}, '⚠ '+err),
      aviso && e('div', {style:{marginBottom:14, padding:'11px 14px', background:v('green-dim'), border:`1px solid ${v('green')}40`, borderRadius:9, fontFamily:"var(--sans)", fontSize:12, color:v('green'), lineHeight:1.7}}, '✓ '+aviso),

      e('button', {onClick:enviar, disabled:loading,
        style:{...T.btnPrimary, opacity:loading?0.7:1, cursor:loading?'wait':'pointer'},
        onMouseEnter:ev=>{if(!loading) ev.currentTarget.style.transform='translateY(-1px)';},
        onMouseLeave:ev=>{ev.currentTarget.style.transform='translateY(0)';}},
        loading ? 'Processando…'
          : mode==='login' ? 'Entrar  →'
          : mode==='cadastro' ? 'Criar minha conta  →'
          : 'Enviar link de recuperação'),

      e('div', {style:{marginTop:16, textAlign:'center'}},
        mode==='login' && e('button', {onClick:()=>{setMode('recuperar'); setErr(''); setAviso('');},
          style:{background:'none', border:'none', color:v('muted'), fontSize:12, cursor:'pointer', fontFamily:"var(--sans)", textDecoration:'underline'}}, 'Esqueci minha senha'),
        mode==='recuperar' && e('button', {onClick:()=>{setMode('login'); setErr(''); setAviso('');},
          style:{background:'none', border:'none', color:v('muted'), fontSize:12, cursor:'pointer', fontFamily:"var(--sans)", textDecoration:'underline'}}, '← Voltar para o login'),
      ),

      mode === 'cadastro' && e('div', {style:{marginTop:20, padding:'13px 15px', background:v('accent-dim'), border:`1px solid ${v('accent')}30`, borderRadius:10, fontFamily:"var(--sans)", fontSize:11.5, color:v('text-s'), lineHeight:1.8}},
        e('strong', {style:{color:v('accent')}}, '✦ Gratuito, sem configurar nada. '),
        'Você entra e já conversa. Há um limite diário de mensagens para o uso ficar equilibrado entre todos.',
      ),

      e('div', {style:{marginTop:26, textAlign:'center', fontFamily:"var(--sans)", fontSize:10, color:v('faint'), letterSpacing:'0.6px'}}, 'Nexus IA · Assistente de IA generativa'),
    )
  );
}


// ── Avatar ────────────────────────────────────────────────────────
function Avatar({role, user}){
  if(role==='user' && user){
    const init = (user.name||user.username||'U').split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
    return e('div', {style:{width:32, height:32, borderRadius:9, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, fontFamily:"var(--sans)", background:`linear-gradient(135deg, ${v('blue')}, ${v('blue-l')})`, color:'#fff', letterSpacing:'0.5px'}}, init);
  }
  return e('div', {style:{width:32, height:32, borderRadius:9, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:"var(--display)", fontSize:17, fontWeight:700, background:`linear-gradient(135deg, ${v('accent-l')}, ${v('accent')}, ${v('accent-deep')})`, color:'#fff'}}, 'N');
}

// ── Tool Block ────────────────────────────────────────────────────
function ToolBlock({tool, done}){
  return e('div', {style:{background:v('elevated'), border:`1px solid ${done?v('green'):v('blue')}40`, borderLeft:`3px solid ${done?v('green'):v('blue')}`, borderRadius:9, padding:'10px 14px', margin:'8px 0', fontFamily:"var(--mono)", fontSize:11}},
    e('div', {style:{display:'flex', alignItems:'center', gap:8, marginBottom:done&&tool.args?6:0}},
      e('span', null, tool.icon||'⚙'),
      e('span', {style:{color:done?v('green'):v('blue'), fontWeight:600}}, tool.name),
      e('span', {style:{marginLeft:'auto', fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'1px', color:done?v('green'):v('muted')}}, done?'✓ concluído':'processando…'),
    ),
    tool.args && e('div', {style:{color:v('muted'), fontSize:10.5, lineHeight:1.6}, dangerouslySetInnerHTML:{__html: tool.args.replace(/<b>/g, `<b style="color:${v('accent')}">`)}}),
  );
}

// ── Message ───────────────────────────────────────────────────────
function Message({msg, user, onCopy}){
  const isAI = msg.role === 'assistant';
  const ts = fmtTime(msg.timestamp || Date.now());
  const [hover, setHover] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    try{ navigator.clipboard.writeText(msg.content); setCopied(true); setTimeout(()=>setCopied(false), 1800); }
    catch{}
  };

  return e('div', {
    onMouseEnter:()=>setHover(true), onMouseLeave:()=>setHover(false),
    style:{display:'flex', gap:11, marginBottom:24, flexDirection:isAI?'row':'row-reverse', animation:'fadeUp 0.3s ease', maxWidth:900, width:'100%', margin:'0 auto 24px', alignItems:'flex-start'}},
    e(Avatar, {role:isAI?'ai':'user', user}),
    e('div', {style:{maxWidth:'calc(100% - 48px)', minWidth:0, flex:'0 1 auto'}},
      e('div', {style:{display:'flex', alignItems:'center', gap:10, marginBottom:6, flexDirection:isAI?'row':'row-reverse'}},
        e('span', {style:{fontSize:12, fontWeight:700, color:isAI?v('accent'):v('blue'), fontFamily:"var(--sans)", letterSpacing:'0.2px'}}, isAI?'Nexus IA':user?.name||'Você'),
        e('span', {style:{fontSize:10.5, color:v('faint'), fontFamily:"var(--sans)"}}, ts),
        isAI && hover && e('button', {
          onClick:handleCopy,
          style:{background:'transparent', border:`1px solid ${v('border')}`, borderRadius:6, padding:'2px 8px', fontSize:10, color:copied?v('green'):v('muted'), cursor:'pointer', fontFamily:"var(--sans)", transition:'all 0.15s', marginLeft:'auto'},
        }, copied?'✓ copiado':'⎘ copiar'),
      ),
      msg.files && msg.files.length > 0 && e('div', {style:{display:'flex', flexWrap:'wrap', gap:6, marginBottom:7, justifyContent:isAI?'flex-start':'flex-end'}},
        msg.files.map((f,i)=>e('div', {key:i, style:{display:'flex', alignItems:'center', gap:7, padding:'6px 11px', background:v('elevated'), border:`1px solid ${v('border')}`, borderRadius:8, fontSize:11.5, fontFamily:"var(--sans)"}},
          e('span', {style:{fontSize:13}}, fileIcon(f.ext)),
          e('span', {style:{color:v('text'), fontWeight:600}}, f.name),
          e('span', {style:{color:v('muted'), fontSize:10}}, fmtBytes(f.size)),
        ))
      ),
      msg.ranTools && msg.ranTools.map((t,i)=>e('div', {key:'rt'+i,
        style:{display:'flex', alignItems:'center', gap:9, padding:'8px 13px', margin:'6px 0',
          background:v('elevated'), border:`1px solid ${t.done?v('green'):v('blue')}40`,
          borderLeft:`3px solid ${t.done?v('green'):v('blue')}`, borderRadius:8,
          fontSize:11.5, fontFamily:"var(--sans)"}},
        e('span', {style:{fontSize:14}}, t.icon),
        e('span', {style:{color:t.done?v('green'):v('blue'), fontWeight:700}}, t.label),
        t.detail && e('span', {style:{color:v('muted'), overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:280, fontFamily:"var(--mono)", fontSize:10.5}}, String(t.detail).slice(0,90)),
        e('span', {style:{marginLeft:'auto', fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'1px', color:t.done?v('green'):v('muted'), flexShrink:0}},
          t.done ? '✓ pronto' : 'executando…'),
      )),
      msg.tools && msg.tools.map((t,i)=>e(ToolBlock, {key:i, tool:t, done:!!msg.toolsDone})),
      e('div', {style:{
        background:isAI ? v('msg-ai-bg') : v('msg-user-bg'),
        border:`1px solid ${isAI ? v('border') : v('blue')+'30'}`,
        borderRadius: isAI ? '3px 14px 14px 14px' : '14px 3px 14px 14px',
        padding:'13px 17px',
        boxShadow:`0 1px 3px ${v('shadow')}`,
        overflowWrap:'anywhere', wordBreak:'break-word',
      }},
        isAI ? e(Md, {content:msg.content||''}) : e('div', {style:{fontSize:14.5, lineHeight:1.7, color:v('text'), fontFamily:"var(--sans)", whiteSpace:'pre-wrap', wordBreak:'break-word'}}, msg.content),
      ),
      msg.switched && e('div', {style:{marginTop:6, display:'flex', alignItems:'center', gap:6, padding:'5px 11px', background:v('blue-dim'), border:`1px solid ${v('blue')}40`, borderRadius:7}},
        e('span', {style:{fontSize:11, color:v('blue'), fontWeight:700, fontFamily:"var(--sans)"}}, '⚡ Limite atingido — respondido por ' + msg.switched.provider),
      ),
      msg.savedDoc && e('div', {style:{marginTop:6, display:'flex', alignItems:'center', gap:6, padding:'5px 11px', background:v('green-dim'), border:`1px solid ${v('green')}40`, borderRadius:7}},
        e('span', {style:{fontSize:11, color:v('green'), fontWeight:700, fontFamily:"var(--sans)"}}, '▪ Salvo no Arquivo · ' + msg.savedDoc.name),
      ),
    )
  );
}

// ── Typing ────────────────────────────────────────────────────────
function Typing(){
  return e('div', {style:{display:'flex', gap:11, marginBottom:24, maxWidth:900, width:'100%', margin:'0 auto 24px'}},
    e(Avatar, {role:'ai'}),
    e('div', {style:{padding:'14px 18px', background:v('msg-ai-bg'), border:`1px solid ${v('border')}`, borderRadius:'3px 14px 14px 14px', display:'flex', alignItems:'center', gap:6}},
      [0, 0.2, 0.4].map((d,i)=>e('div', {key:i, style:{width:6, height:6, borderRadius:'50%', background:v('accent'), animation:`bounceDot 1.2s ease-in-out ${d}s infinite`}})),
    )
  );
}

// ── NavItem ───────────────────────────────────────────────────────
function NavItem({icon, label, active, onClick, badge}){
  const [hov, setHov] = useState(false);
  return e('div', {
    onClick, onMouseEnter:()=>setHov(true), onMouseLeave:()=>setHov(false),
    style:{
      display:'flex', alignItems:'center', gap:10, padding:'9px 11px', borderRadius:8,
      cursor:'pointer', marginBottom:1,
      background: active ? v('accent-dim') : hov ? v('elevated') : 'transparent',
      border:`1px solid ${active ? v('accent')+'40' : 'transparent'}`,
      color: active ? v('accent') : hov ? v('text') : v('muted'),
      fontSize:12.5, fontWeight: active?600:500, transition:'all 0.12s', fontFamily:"var(--sans)",
    }},
    e('span', {style:{fontSize:14, width:17, textAlign:'center', flexShrink:0}}, icon),
    e('span', {style:{flex:1}}, label),
    badge && e('span', {style:{fontSize:9, fontWeight:800, padding:'2px 7px', borderRadius:99, background:v('accent-dim'), color:v('accent')}}, badge),
  );
}

// ── Sidebar ───────────────────────────────────────────────────────
function Sidebar({user, perfil, cota, convs, activeId, onSelect, onNew, onDelete, view, onView, onLogout, cloudStatus}){
  const isAdmin = perfil?.papel === 'admin';
  return e('div', {style:{width:248, minWidth:248, background:v('surface'), borderRight:`1px solid ${v('border')}`, display:'flex', flexDirection:'column', height:'100vh', overflow:'hidden'}},

    // Brand
    e('div', {style:{padding:'20px 18px 15px', borderBottom:`1px solid ${v('border')}`}},
      e('div', {style:{fontFamily:"var(--display)", fontSize:24, fontWeight:700, color:v('accent'), letterSpacing:'-0.4px', lineHeight:1.1}}, 'Nexus IA'),
      e('div', {style:{fontFamily:"var(--sans)", fontSize:9.5, color:v('muted'), letterSpacing:'1.8px', textTransform:'uppercase', marginTop:4, fontWeight:500}}, 'Assistente Generativo'),
    ),

    // User info
    e('div', {style:{padding:'12px 15px', borderBottom:`1px solid ${v('border')}`, display:'flex', alignItems:'center', gap:10}},
      e(Avatar, {role:'user', user:{name: perfil?.nome || user.email}}),
      e('div', {style:{minWidth:0, flex:1}},
        e('div', {style:{fontSize:12.5, fontWeight:700, color:v('text'), fontFamily:"var(--sans)", overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}, perfil?.nome || user.email),
        e('div', {style:{fontSize:10, color: isAdmin?v('accent'):v('muted'), fontFamily:"var(--sans)", fontWeight:isAdmin?700:400, letterSpacing:'0.3px'}}, isAdmin?'👑 Administrador':'Usuário'),
      ),
    ),

    // Nav
    e('div', {style:{padding:'12px 9px 4px'}},
      e('div', {style:{fontSize:9, fontWeight:700, color:v('faint'), letterSpacing:'1.8px', textTransform:'uppercase', padding:'0 9px 8px', fontFamily:"var(--sans)"}}, 'Navegação'),
      e(NavItem, {icon:'💬', label:'Chat', active:view==='chat', onClick:()=>onView('chat')}),
      e(NavItem, {icon:'▪', label:'Arquivo de Docs', active:view==='arquivo', onClick:()=>onView('arquivo')}),
      e(NavItem, {icon:'⚙', label:'Configurações', active:view==='settings', onClick:()=>onView('settings')}),
      isAdmin && e(NavItem, {icon:'👥', label:'Usuários', active:view==='admin', onClick:()=>onView('admin')}),
    ),

    // New conv button
    e('div', {style:{padding:'0 9px 10px'}},
      e('button', {onClick:onNew,
        style:{
          width:'100%', padding:'11px', borderRadius:9, cursor:'pointer',
          background:`linear-gradient(135deg, ${v('accent-l')}, ${v('accent')}, ${v('accent-deep')})`,
          border:'none', color:'#fff', fontSize:12.5, fontWeight:700, fontFamily:"var(--sans)",
          transition:'all 0.18s', boxShadow:`0 6px 18px ${v('accent-glow')}`,
          display:'flex', alignItems:'center', justifyContent:'center', gap:7,
        },
        onMouseEnter:ev=>{ev.currentTarget.style.transform='translateY(-1px)'; ev.currentTarget.style.boxShadow=`0 10px 26px ${v('accent-glow')}`;},
        onMouseLeave:ev=>{ev.currentTarget.style.transform='translateY(0)'; ev.currentTarget.style.boxShadow=`0 6px 18px ${v('accent-glow')}`;},
      },
        e('span', {style:{fontSize:14}}, '✦'),
        'Nova conversa',
      ),
    ),

    // Conv list
    e('div', {style:{fontSize:9, fontWeight:700, color:v('faint'), letterSpacing:'1.8px', textTransform:'uppercase', padding:'4px 18px 6px', fontFamily:"var(--sans)"}}, 'Conversas'),
    e('div', {style:{flex:1, overflowY:'auto', padding:'0 9px'}},
      convs.length===0 ? e('div', {style:{padding:'24px 12px', textAlign:'center', fontSize:11.5, color:v('faint'), fontFamily:"var(--sans)", fontStyle:'italic'}}, 'Nenhuma conversa ainda') :
      convs.map(c => e('div', {
        key:c.id, onClick:()=>{onSelect(c.id); onView('chat');},
        style:{
          display:'flex', alignItems:'center', gap:7, padding:'8px 11px', borderRadius:8,
          cursor:'pointer', marginBottom:2,
          background: c.id===activeId ? v('accent-dim') : 'transparent',
          border:`1px solid ${c.id===activeId ? v('accent')+'30' : 'transparent'}`,
          transition:'all 0.12s',
        },
        onMouseEnter:ev=>{if(c.id!==activeId) ev.currentTarget.style.background=v('elevated');},
        onMouseLeave:ev=>{if(c.id!==activeId) ev.currentTarget.style.background='transparent';},
      },
        e('div', {style:{flex:1, minWidth:0, fontSize:11.5, fontWeight:c.id===activeId?600:500, color:c.id===activeId?v('accent'):v('text-s'), overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontFamily:"var(--sans)"}}, c.title),
        e('button', {onClick:ev=>{ev.stopPropagation(); onDelete(c.id);}, style:{background:'none', border:'none', color:v('faint'), cursor:'pointer', fontSize:14, padding:'0 3px', lineHeight:1, flexShrink:0}}, '×'),
      ))
    ),

    // Footer
    e('div', {style:{padding:'12px 9px 14px', borderTop:`1px solid ${v('border')}`, display:'flex', flexDirection:'column', gap:6}},
      cota && e('div', {style:{padding:'9px 11px', borderRadius:8, background:v('elevated'), border:`1px solid ${v('border')}`}},
        e('div', {style:{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:6}},
          e('span', {style:{fontSize:9.5, fontWeight:700, color:v('faint'), letterSpacing:'1px', textTransform:'uppercase', fontFamily:"var(--sans)"}}, 'Hoje'),
          e('span', {style:{fontSize:11, fontWeight:700, color:v('text'), fontFamily:"var(--mono)"}},
            cota.limite >= 99999 ? '∞' : `${cota.usadas}/${cota.limite}`),
        ),
        e('div', {style:{height:4, background:v('border'), borderRadius:99, overflow:'hidden'}},
          e('div', {style:{height:'100%', borderRadius:99,
            width: cota.limite>0 ? Math.min(100, (cota.usadas/cota.limite)*100)+'%' : '0%',
            background: (cota.usadas/cota.limite)>0.85 ? v('red') : (cota.usadas/cota.limite)>0.6 ? v('accent') : v('green'),
            transition:'width 0.3s'}})),
      ),
      e('div', {style:{display:'flex', alignItems:'center', gap:8, padding:'7px 11px', borderRadius:8, background:v('elevated'), border:`1px solid ${v('border')}`}},
        e('div', {style:{width:6, height:6, borderRadius:'50%',
          background: cloudStatus==='online'?v('green'):cloudStatus==='offline'?v('red'):v('accent'),
          boxShadow: cloudStatus==='online'?`0 0 8px ${v('green')}80`:cloudStatus==='offline'?`0 0 8px ${v('red')}80`:`0 0 8px ${v('accent')}80`,
          flexShrink:0, animation:'pulse 2s ease infinite'}}),
        e('span', {style:{fontSize:10.5, fontWeight:600, color:v('text'), fontFamily:"var(--sans)"}},
          cloudStatus==='online'?'☁ Sincronizado':cloudStatus==='offline'?'📵 Offline':'Conectando…'),
      ),
      e('button', {onClick:onLogout,
        style:{width:'100%', padding:'8px', borderRadius:8, cursor:'pointer', background:'transparent', border:`1px solid ${v('border')}`, color:v('muted'), fontSize:11, fontFamily:"var(--sans)", transition:'all 0.12s', fontWeight:500},
        onMouseEnter:ev=>{ev.currentTarget.style.borderColor=v('red'); ev.currentTarget.style.color=v('red');},
        onMouseLeave:ev=>{ev.currentTarget.style.borderColor=v('border'); ev.currentTarget.style.color=v('muted');},
      }, '↩ Sair'),
    )
  );
}

// ── Welcome ───────────────────────────────────────────────────────
function Welcome({user, onSuggest, mode}){
  const SUGS = {
    academic:['🎓 Elabore um resumo de dissertação em PLN','📅 Crie um cronograma de mestrado para 24 meses','🔬 Sugira metodologia para pesquisa em IA aplicada','📚 Formate esta referência segundo ABNT NBR 6023','🧐 Revisar texto acadêmico com normas ABNT','🎯 Simular banca examinadora de mestrado'],
    institutional:['📝 Gere um ofício institucional para parceria com a UFPB','📋 Briefing para reunião de orientação acadêmica','⚖ Parecer técnico sobre aquisição de equipamentos','📄 Memorando circular para servidores do setor','🏛 Ata de reunião de colegiado','✉ Email formal de resposta a solicitação'],
    research:['🔬 Esboce metodologia para estudo quantitativo','📊 Análise estatística: qual teste usar para dados pareados?','📑 Estrutura de artigo para revista Qualis A1','🧪 Desenho experimental para validar hipótese','📚 Revisão sistemática: protocolo PRISMA','🎯 Formulação de hipóteses e perguntas de pesquisa'],
    technical:['🏗 Inicie um projeto seguindo workflow estruturado','🧭 Explore a arquitetura de um sistema Next.js','📐 Projete 3 abordagens para uma feature de cache','🧹 Revise este código: bugs, DRY e convenções','🧪 Gere testes unitários com AAA pattern','💾 Mensagem de commit + PR description'],
    public:['⚖️ Análise de conformidade com Lei 14.133/2021','📊 Relatório de inventário patrimonial anual','🎯 Plano de ação para recolhimento de bens inservíveis','📄 Parecer sobre dispensa de licitação','📋 Briefing sobre Decreto 12.785/2025','🏛 Procedimento para movimentação de bens'],
    general:['📝 Gere um ofício institucional para parceria','🎓 Elabore um resumo de dissertação','💻 Ajude a projetar uma feature de autenticação','📊 Relatório técnico estruturado','🎯 Plano de ação com prazos e KPIs','⚖ Análise crítica com recomendações'],
  };
  const MODE_TITLE = {academic:'Acadêmico', institutional:'Institucional', research:'Pesquisa', technical:'Técnico', public:'Pública', general:'Geral'};
  const sugs = SUGS[mode] || SUGS.general;
  const firstName = (user.name||'').split(' ')[0];

  return e('div', {style:{display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'70vh', textAlign:'center', padding:'2rem', animation:'fadeIn 0.5s ease'}},
    e('div', {style:{fontFamily:"var(--display)", fontSize:64, fontWeight:700, color:v('accent'), letterSpacing:'-1.6px', lineHeight:1, marginBottom:12, animation:'float 4s ease infinite'}}, 'Nexus IA'),
    e('p', {style:{color:v('text'), fontSize:18, marginBottom:6, fontFamily:"var(--display)", fontWeight:500, fontStyle:'italic', letterSpacing:'-0.2px'}}, `Olá, ${firstName}.`),
    e('p', {style:{color:v('text-s'), fontSize:14, marginBottom:6, fontFamily:"var(--sans)"}}, 'O que você precisa hoje?'),
    e('div', {style:{display:'inline-flex', alignItems:'center', gap:7, padding:'4px 14px', borderRadius:99, background:v('accent-dim'), border:`1px solid ${v('accent')}30`, marginBottom:22, marginTop:4}},
      e('span', {style:{width:6, height:6, borderRadius:'50%', background:v('accent'), animation:'pulse 2s infinite'}}),
      e('span', {style:{fontSize:10, color:v('accent'), fontFamily:"var(--sans)", fontWeight:700, letterSpacing:'1.2px', textTransform:'uppercase'}}, 'Modo '+(MODE_TITLE[mode]||'Geral')),
    ),
    e('p', {style:{color:v('faint'), fontSize:11.5, marginBottom:34, fontFamily:"var(--sans)", letterSpacing:'0.6px'}}, 'Digite / para ver os comandos disponíveis'),
    e('div', {style:{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(230px, 1fr))', gap:11, width:'100%', maxWidth:740}},
      sugs.map((t,i) => e('div', {key:i, onClick:()=>onSuggest(t),
        style:{padding:'15px 17px', borderRadius:12, border:`1px solid ${v('border')}`, background:v('card'), color:v('text-s'), fontSize:13, textAlign:'left', lineHeight:1.55, fontFamily:"var(--sans)", cursor:'pointer', transition:'all 0.2s', boxShadow:`0 1px 3px ${v('shadow')}`},
        onMouseEnter:ev=>{ev.currentTarget.style.borderColor=v('accent'); ev.currentTarget.style.color=v('text'); ev.currentTarget.style.background=v('accent-dim'); ev.currentTarget.style.transform='translateY(-2px)'; ev.currentTarget.style.boxShadow=`0 8px 20px ${v('shadow')}`;},
        onMouseLeave:ev=>{ev.currentTarget.style.borderColor=v('border'); ev.currentTarget.style.color=v('text-s'); ev.currentTarget.style.background=v('card'); ev.currentTarget.style.transform='translateY(0)'; ev.currentTarget.style.boxShadow=`0 1px 3px ${v('shadow')}`;}
      }, t))
    )
  );
}

// ── Chat View ─────────────────────────────────────────────────────
function ChatView({user, conv, cfg, onSend, loading, onClear, theme, onChangeTheme}){
  const [input, setInput] = useState('');
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashFiltered, setSlashFiltered] = useState([]);
  const [slashIdx, setSlashIdx] = useState(0);
  const [files, setFiles] = useState([]);       // {name, size, ext, content}
  const [fileErr, setFileErr] = useState('');
  const [reading, setReading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const bottomRef = useRef(null);
  const textRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:'smooth'});}, [conv?.messages?.length, loading]);

  const addFiles = async (list) => {
    const arr = Array.from(list || []);
    if(!arr.length) return;
    setFileErr(''); setReading(true);
    for(const f of arr){
      try{
        const content = await extractFile(f);
        const ext = (f.name.split('.').pop()||'').toLowerCase();
        setFiles(p => [...p, {name:f.name, size:f.size, ext, content}]);
      }catch(err){
        setFileErr(`${f.name}: ${err.message}`);
      }
    }
    setReading(false);
    textRef.current?.focus();
  };

  const send = (txt) => {
    const t = (txt||input).trim();
    if((!t && !files.length) || loading) return;
    setInput(''); if(textRef.current) textRef.current.style.height='auto';
    setSlashOpen(false);
    onSend(t || 'Analise o(s) arquivo(s) anexado(s).', files);
    setFiles([]); setFileErr('');
  };

  const handleInput = ev => {
    const val = ev.target.value;
    setInput(val);
    ev.target.style.height='auto';
    ev.target.style.height=Math.min(ev.target.scrollHeight,180)+'px';
    if(val.startsWith('/')){
      const f = SLASH_COMMANDS.filter(c=>c.cmd.startsWith(val.toLowerCase()));
      if(f.length){setSlashFiltered(f); setSlashOpen(true); setSlashIdx(0); return;}
    }
    setSlashOpen(false);
  };

  const handleKey = ev => {
    if(slashOpen){
      if(ev.key==='ArrowDown'){ev.preventDefault(); setSlashIdx(i=>Math.min(i+1, slashFiltered.length-1)); return;}
      if(ev.key==='ArrowUp'){ev.preventDefault(); setSlashIdx(i=>Math.max(i-1, 0)); return;}
      if(ev.key==='Tab'||ev.key==='Enter'){ev.preventDefault(); selSlash(slashFiltered[slashIdx].cmd); return;}
      if(ev.key==='Escape'){setSlashOpen(false); return;}
    }
    if(ev.key==='Enter' && !ev.shiftKey){ev.preventDefault(); send();}
  };

  const selSlash = cmd => {setInput(cmd+' '); setSlashOpen(false); textRef.current?.focus();};
  const modelInfo = MODELS.find(m=>m.id===cfg.model);
  const hasKey = hasAnyKey(cfg);
  const estTokens = Math.round((conv?.messages||[]).reduce((s,m)=>s+(m.content||'').length, 0) / 4);

  return e('div', {style:{flex:1, display:'flex', flexDirection:'column', overflow:'hidden', height:'100vh'}},

    // Topbar
    e('div', {style:{height:54, flexShrink:0, background:v('surface'), borderBottom:`1px solid ${v('border')}`, display:'flex', alignItems:'center', padding:'0 22px', gap:13, backdropFilter:'blur(8px)'}},
      e('div', {style:{flex:1, fontSize:14, fontWeight:600, color:v('text'), fontFamily:"var(--sans)", overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}, conv?.title||'Nova conversa'),
      modelInfo && e('div', {style:{fontFamily:"var(--mono)", fontSize:10, color:v('muted'), background:v('elevated'), border:`1px solid ${v('border')}`, borderRadius:6, padding:'4px 10px', flexShrink:0, fontWeight:500}}, modelInfo.label.split('—')[0].trim()),
      e(ThemeSwitcher, {currentTheme:theme, onChange:onChangeTheme, compact:true}),
      e('button', {onClick:onClear,
        style:{background:'transparent', border:`1px solid ${v('border')}`, color:v('muted'), borderRadius:7, padding:'5px 12px', fontSize:11, cursor:'pointer', transition:'all 0.15s', fontFamily:"var(--sans)", fontWeight:500},
        onMouseEnter:ev=>{ev.currentTarget.style.borderColor=v('red'); ev.currentTarget.style.color=v('red');},
        onMouseLeave:ev=>{ev.currentTarget.style.borderColor=v('border'); ev.currentTarget.style.color=v('muted');}
      }, '🗑 Limpar'),
    ),

    // Context bar
    e('div', {style:{padding:'6px 22px', borderBottom:`1px solid ${v('border')}`, background:v('elevated'), display:'flex', alignItems:'center', gap:8, fontSize:10, color:v('muted'), overflowX:'auto', flexShrink:0, fontFamily:"var(--mono)"}},
      e('span', {style:{color:v('faint'), fontWeight:600}}, 'ctx'),
      ...[`~${estTokens}t`, cfg.mode||'general', 'groq'].map((t,i) =>
        e('span', {key:i, style:{background:v('card'), border:`1px solid ${i===2?v('green')+'40':i===1?v('accent')+'40':v('border')}`, borderRadius:5, padding:'2px 9px', color:i===2?v('green'):i===1?v('accent'):v('muted'), whiteSpace:'nowrap', fontWeight:500}}, t)),
    ),

    // Messages
    e('div', {style:{flex:1, overflowY:'auto', padding:'24px 22px'}},
      !conv || conv.messages.length===0 ? e(Welcome, {user, onSuggest:t=>send(t), mode:cfg.mode||'general'}) :
        e(React.Fragment, null,
          ...conv.messages.map(m => e(Message, {key:m.id, msg:m, user})),
          loading ? e(Typing) : null,
        ),
      e('div', {ref:bottomRef}),
    ),

    // Input
    e('div', {style:{flexShrink:0, borderTop:`1px solid ${v('border')}`, background:v('surface'), padding:'14px 22px 16px'}},
      e('div', {style:{maxWidth:900, margin:'0 auto'}},
        !hasKey && e('div', {style:{marginBottom:12, padding:'10px 15px', background:v('accent-dim'), border:`1px solid ${v('accent')}40`, borderRadius:9, fontSize:12.5, color:v('accent'), fontFamily:"var(--sans)", fontWeight:500}}, '⚠ Configure ao menos uma API Key em Configurações para começar'),

        // Chips dos arquivos anexados
        files.length > 0 && e('div', {style:{display:'flex', flexWrap:'wrap', gap:7, marginBottom:9}},
          files.map((f,i) => e('div', {key:i,
            style:{display:'flex', alignItems:'center', gap:8, padding:'7px 11px', background:v('card'), border:`1px solid ${v('accent')}50`, borderRadius:9, fontSize:12, fontFamily:"var(--sans)", maxWidth:300}},
            e('span', {style:{fontSize:14, flexShrink:0}}, fileIcon(f.ext)),
            e('div', {style:{minWidth:0, flex:1}},
              e('div', {style:{color:v('text'), fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}, f.name),
              e('div', {style:{color:v('muted'), fontSize:10}}, `${fmtBytes(f.size)} · ${Math.round(f.content.length/4)} tokens`),
            ),
            e('button', {onClick:()=>setFiles(p=>p.filter((_,j)=>j!==i)),
              style:{background:'none', border:'none', color:v('faint'), cursor:'pointer', fontSize:15, padding:'0 2px', lineHeight:1, flexShrink:0}}, '×'),
          ))
        ),

        reading && e('div', {style:{marginBottom:9, padding:'8px 13px', background:v('blue-dim'), border:`1px solid ${v('blue')}40`, borderRadius:9, fontSize:12, color:v('blue'), fontFamily:"var(--sans)", display:'flex', alignItems:'center', gap:8}},
          e('span', {style:{width:12, height:12, border:`2px solid ${v('blue')}40`, borderTopColor:v('blue'), borderRadius:'50%', display:'inline-block', animation:'spin 0.7s linear infinite'}}),
          'Lendo arquivo…'),

        fileErr && e('div', {style:{marginBottom:9, padding:'8px 13px', background:v('red-dim'), border:`1px solid ${v('red')}40`, borderRadius:9, fontSize:12, color:v('red'), fontFamily:"var(--sans)"}}, '⚠ ' + fileErr),

        // Slash menu
        slashOpen && e('div', {style:{background:v('card'), border:`1px solid ${v('border')}`, borderRadius:11, padding:6, marginBottom:8, boxShadow:`0 12px 32px ${v('shadow')}`, maxHeight:320, overflowY:'auto'}},
          (() => {
            const byCat = {};
            slashFiltered.forEach((c,i)=>{const k=c.cat||'outros'; (byCat[k]=byCat[k]||[]).push({...c, __idx:i});});
            const order = ['sistema','acadêmico','técnico','profissional','outros'];
            const labels = {sistema:'Sistema', acadêmico:'Acadêmico', técnico:'Técnico / Código', profissional:'Profissional', outros:'Outros'};
            const out = [];
            order.forEach(k=>{
              if(!byCat[k]) return;
              out.push(e('div', {key:'h_'+k, style:{fontSize:9, fontWeight:700, color:v('faint'), letterSpacing:'1.5px', textTransform:'uppercase', padding:'8px 11px 4px', fontFamily:"var(--sans)"}}, labels[k]));
              byCat[k].forEach(c=>out.push(
                e('div', {key:c.cmd, onClick:()=>selSlash(c.cmd),
                  style:{padding:'8px 13px', borderRadius:8, display:'flex', alignItems:'center', gap:11, cursor:'pointer', background:c.__idx===slashIdx?v('accent-dim'):'transparent', transition:'background 0.1s'},
                  onMouseEnter:()=>setSlashIdx(c.__idx)},
                  e('span', {style:{fontSize:14}}, c.icon),
                  e('span', {style:{fontFamily:"var(--mono)", fontSize:11.5, fontWeight:500, color:v('accent'), minWidth:150}}, c.cmd),
                  e('span', {style:{fontSize:11.5, color:v('text-s'), fontFamily:"var(--sans)"}}, c.desc),
                )
              ));
            });
            return out;
          })()
        ),

        // Input row
        e('div', {style:{display:'flex', gap:9, alignItems:'flex-end'}},
          e('input', {ref:fileRef, type:'file', multiple:true, style:{display:'none'},
            accept:'.pdf,.docx,.xlsx,.xlsm,.xls,.csv,.tsv,.txt,.md,.json,.xml,.html,.log,.js,.ts,.py,.sql,.yml,.yaml',
            onChange:ev=>{addFiles(ev.target.files); ev.target.value='';}}),
          e('div', {style:{flex:1, background:v('card'), border:`1px solid ${dragOver?v('accent'):v('border')}`, borderRadius:12, display:'flex', flexDirection:'column', overflow:'hidden', transition:'border-color 0.2s, box-shadow 0.2s', boxShadow:dragOver?`0 0 0 3px ${v('accent-dim')}`:'none'},
            onDragOver:ev=>{ev.preventDefault(); setDragOver(true);},
            onDragLeave:()=>setDragOver(false),
            onDrop:ev=>{ev.preventDefault(); setDragOver(false); addFiles(ev.dataTransfer.files);},
            onFocusCapture:ev=>{ev.currentTarget.style.borderColor=v('accent'); ev.currentTarget.style.boxShadow=`0 0 0 3px ${v('accent-dim')}`;},
            onBlurCapture:ev=>{if(!dragOver){ev.currentTarget.style.borderColor=v('border'); ev.currentTarget.style.boxShadow='none';}}},
            e('textarea', {ref:textRef, value:input, onChange:handleInput, onKeyDown:handleKey,
              onPaste:ev=>{const fs=ev.clipboardData?.files; if(fs&&fs.length){ev.preventDefault(); addFiles(fs);}},
              placeholder:hasKey?(dragOver?'Solte o arquivo aqui…':'Mensagem… (/ comandos · arraste arquivos · Enter envia)'):'Configure sua API Key primeiro…',
              disabled:!hasKey||loading, rows:1,
              style:{width:'100%', background:'transparent', border:'none', outline:'none', color:v('text'), fontSize:14.5, lineHeight:1.65, resize:'none', padding:'12px 15px', maxHeight:180, fontFamily:"var(--sans)"}}),
            e('div', {style:{padding:'3px 14px 8px', display:'flex', alignItems:'center', gap:8}},
              e('button', {onClick:()=>fileRef.current?.click(), disabled:!hasKey||loading||reading, title:'Anexar arquivo (PDF, Word, Excel, CSV, texto)',
                style:{background:'none', border:`1px solid ${v('border')}`, borderRadius:6, padding:'3px 9px', fontSize:11, color:v('muted'), cursor:(hasKey&&!loading&&!reading)?'pointer':'not-allowed', fontFamily:"var(--sans)", fontWeight:600, transition:'all 0.15s', display:'flex', alignItems:'center', gap:5},
                onMouseEnter:ev=>{if(hasKey&&!loading&&!reading){ev.currentTarget.style.borderColor=v('accent'); ev.currentTarget.style.color=v('accent');}},
                onMouseLeave:ev=>{ev.currentTarget.style.borderColor=v('border'); ev.currentTarget.style.color=v('muted');}},
                '📎 Anexar'),
              e('span', {style:{fontSize:10, color:v('faint'), fontFamily:"var(--sans)"}},
                e('kbd', {style:{background:v('elevated'), border:`1px solid ${v('border')}`, borderRadius:4, padding:'1px 6px', fontSize:9.5, fontFamily:"var(--mono)"}}, 'Enter'), ' enviar'),
              e('span', {style:{marginLeft:'auto', fontSize:10, color:v('faint'), fontFamily:"var(--mono)"}}, input.length),
            ),
          ),
          (()=>{const ready = hasKey && !loading && (input.trim() || files.length>0); return (
          e('button', {onClick:()=>send(), disabled:!ready,
            style:{width:44, height:44, flexShrink:0, borderRadius:10, border:'none',
              cursor:ready?'pointer':'not-allowed',
              background:ready?`linear-gradient(135deg, ${v('accent-l')}, ${v('accent')}, ${v('accent-deep')})`:v('elevated'),
              color:ready?'#fff':v('faint'),
              fontSize:18, display:'flex', alignItems:'center', justifyContent:'center', transition:'all 0.18s',
              boxShadow:ready?`0 6px 18px ${v('accent-glow')}`:'none'},
            onMouseEnter:ev=>{if(ready){ev.currentTarget.style.transform='scale(1.05)';}},
            onMouseLeave:ev=>{ev.currentTarget.style.transform='scale(1)';},
          }, loading ? e('span', {style:{width:14, height:14, border:'2.5px solid rgba(255,255,255,0.3)', borderTopColor:'#fff', borderRadius:'50%', display:'inline-block', animation:'spin 0.7s linear infinite'}}) : '↑')
          );})(),
        ),
      )
    )
  );
}

// ── Arquivo ───────────────────────────────────────────────────────
function ArquivoView({docs, onDelete, onDownload}){
  const [filter, setFilter] = useState('todos');
  const [query, setQuery] = useState('');
  const filtered = docs.filter(d=>{
    const mt = filter==='todos'||d.type===filter;
    return mt && (!query || d.name.toLowerCase().includes(query.toLowerCase()));
  });
  const filters = [['todos','Todos'], ['relatorio','Relatórios'], ['analise','Análises'], ['rascunho','Rascunhos']];
  return e('div', {style:{flex:1, overflowY:'auto', padding:28}},
    e('div', {style:{marginBottom:24}},
      e('div', {style:{fontFamily:"var(--display)", fontSize:32, fontWeight:700, color:v('text'), marginBottom:5, letterSpacing:'-0.6px'}}, 'Arquivo de Documentos'),
      e('div', {style:{fontSize:13, color:v('text-s'), fontFamily:"var(--sans)"}}, `${docs.length} documento${docs.length!==1?'s':''} gerados pela IA`),
    ),
    e('div', {style:{display:'flex', gap:9, marginBottom:18, flexWrap:'wrap', alignItems:'center'}},
      e('input', {value:query, onChange:ev=>setQuery(ev.target.value), placeholder:'🔍 Buscar documento…',
        style:{...T.input, flex:1, minWidth:220, padding:'9px 14px', fontSize:13}}),
      ...filters.map(([f,l]) => e('button', {key:f, onClick:()=>setFilter(f),
        style:{padding:'8px 16px', borderRadius:8, cursor:'pointer', border:`1px solid ${filter===f?v('accent')+'60':v('border')}`, background:filter===f?v('accent-dim'):v('card'), color:filter===f?v('accent'):v('text-s'), fontSize:11.5, fontWeight:600, fontFamily:"var(--sans)", transition:'all 0.15s'}}, l)),
    ),
    filtered.length===0 ? e('div', {style:{textAlign:'center', padding:'72px 0', color:v('text-s'), fontFamily:"var(--sans)"}},
      e('div', {style:{fontSize:48, marginBottom:16, opacity:0.4}}, '▪'),
      e('div', {style:{fontSize:17, fontWeight:600, color:v('text'), marginBottom:7, fontFamily:"var(--display)"}}, 'Nenhum documento ainda'),
      e('div', {style:{fontSize:13, lineHeight:1.7, maxWidth:380, margin:'0 auto', color:v('muted')}}, 'Respostas longas da IA são salvas aqui automaticamente como documentos.'),
    ) : e('div', {style:{background:v('card'), border:`1px solid ${v('border')}`, borderRadius:14, overflow:'hidden', boxShadow:`0 1px 4px ${v('shadow')}`}},
      e('div', {style:{display:'grid', gridTemplateColumns:'2fr 1fr 90px 100px 80px', padding:'11px 20px', borderBottom:`1px solid ${v('border')}`, background:v('elevated'), fontSize:9, fontWeight:700, color:v('faint'), textTransform:'uppercase', letterSpacing:'1.2px', fontFamily:"var(--sans)"}},
        e('span', null, 'Nome'), e('span', null, 'Data'), e('span', null, 'Hora'), e('span', null, 'Tipo'), e('span', null, 'Ações'),
      ),
      filtered.map((d,i) => {
        const m = TYPE_META[d.type] || TYPE_META.analise;
        return e('div', {key:d.id, style:{display:'grid', gridTemplateColumns:'2fr 1fr 90px 100px 80px', alignItems:'center', padding:'13px 20px', borderBottom:i<filtered.length-1?`1px solid ${v('border')}`:'none', transition:'background 0.12s'},
          onMouseEnter:ev=>ev.currentTarget.style.background=v('accent-dim'),
          onMouseLeave:ev=>ev.currentTarget.style.background='transparent'},
          e('div', {style:{display:'flex', alignItems:'center', gap:11, minWidth:0}},
            e('span', {style:{fontSize:16, flexShrink:0}}, m.icon),
            e('span', {style:{fontSize:13, fontWeight:600, color:v('text'), overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontFamily:"var(--sans)"}}, d.name),
          ),
          e('span', {style:{fontSize:12, color:v('text-s'), fontFamily:"var(--sans)"}}, fmtDate(d.createdAt)),
          e('span', {style:{fontFamily:"var(--display)", fontSize:15, fontWeight:600, color:v('text')}}, fmtTime(d.createdAt)),
          e('span', {style:{fontSize:10.5, fontWeight:700, fontFamily:"var(--sans)", padding:'3px 10px', borderRadius:6, background:v('accent-dim'), color:v('accent'), display:'inline-block', width:'fit-content'}}, m.label),
          e('div', {style:{display:'flex', gap:5}},
            e('button', {onClick:()=>onDownload(d), title:'Baixar', style:{background:'none', border:'none', color:v('muted'), cursor:'pointer', fontSize:15, padding:'4px 8px', borderRadius:6, transition:'all 0.12s'}, onMouseEnter:ev=>{ev.currentTarget.style.color=v('accent'); ev.currentTarget.style.background=v('accent-dim');}, onMouseLeave:ev=>{ev.currentTarget.style.color=v('muted'); ev.currentTarget.style.background='transparent';}}, '⬇'),
            e('button', {onClick:()=>{if(confirm(`Excluir "${d.name}"?`)) onDelete(d.id);}, title:'Excluir', style:{background:'none', border:'none', color:v('muted'), cursor:'pointer', fontSize:15, padding:'4px 8px', borderRadius:6, transition:'all 0.12s'}, onMouseEnter:ev=>{ev.currentTarget.style.color=v('red'); ev.currentTarget.style.background=v('red-dim');}, onMouseLeave:ev=>{ev.currentTarget.style.color=v('muted'); ev.currentTarget.style.background='transparent';}}, '🗑'),
          ),
        );
      })
    )
  );
}

// ── Settings ──────────────────────────────────────────────────────
function SettingsView({user, perfil, cota, cfg, onSave, onSaveNome, theme, onChangeTheme, mems, onDeleteMemory}){
  const _k0 = cfgKeys(cfg);
  const [kGroq, setKGroq] = useState(_k0.groq);
  const [kCerebras, setKCerebras] = useState(_k0.cerebras);
  const [kGemini, setKGemini] = useState(_k0.gemini);
  const [kOpenRouter, setKOpenRouter] = useState(_k0.openrouter);
  const [kTavily, setKTavily] = useState(_k0.tavily);
  const [autonomous, setAutonomous] = useState(cfg.autonomous !== false);
  const [model, setModel] = useState(cfg.model||DEFAULT_MODEL);
  const [mode, setMode] = useState(cfg.mode||'academic');
  const [sys, setSys] = useState(cfg.systemPrompt||'');
  const [name, setName] = useState(perfil?.nome || '');
  const [newPass, setNewPass] = useState('');
  const [saved, setSaved] = useState(false);
  const [passErr, setPassErr] = useState('');
  const [passOk, setPassOk] = useState(false);

  const doSave = () => {
    onSave({...cfg, keyGroq:kGroq, keyCerebras:kCerebras, keyGemini:kGemini, keyOpenRouter:kOpenRouter, keyTavily:kTavily, autonomous, apiKey:undefined, model, mode, systemPrompt:sys});
    if(name !== (perfil?.nome || '')) onSaveNome(name);
    setSaved(true); setTimeout(()=>setSaved(false), 2000);
  };

  const changePass = async () => {
    setPassErr(''); setPassOk(false);
    if(!newPass){setPassErr('Informe a nova senha.'); return;}
    if(newPass.length<6){setPassErr('Mínimo 6 caracteres.'); return;}
    const {error} = await SB.auth.updateUser({password:newPass});
    if(error){ setPassErr(traduzErroAuth(error.message)); return; }
    setNewPass(''); setPassOk(true);
    setTimeout(()=>setPassOk(false), 2500);
  };

  return e('div', {style:{flex:1, overflowY:'auto', padding:28, maxWidth:720}},
    e('div', {style:{marginBottom:28}},
      e('div', {style:{fontFamily:"var(--display)", fontSize:32, fontWeight:700, color:v('text'), marginBottom:5, letterSpacing:'-0.6px'}}, 'Configurações'),
      e('div', {style:{fontSize:13, color:v('text-s'), fontFamily:"var(--sans)"}}, 'Personalize sua experiência no Nexus IA'),
    ),

    // Aparência
    e('div', {style:T.sectionCard},
      e('div', {style:T.sectionTitle}, e('span', null, '🎨'), 'Aparência'),
      e('label', {style:T.label}, 'Tema visual'),
      e('div', {style:{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(170px, 1fr))', gap:10, marginTop:4}},
        THEMES.map(t => e('div', {key:t.id, onClick:()=>onChangeTheme(t.id),
          style:{padding:'14px 15px', borderRadius:11, cursor:'pointer', border:`2px solid ${theme===t.id?v('accent'):v('border')}`, background:theme===t.id?v('accent-dim'):v('elevated'), transition:'all 0.18s', display:'flex', alignItems:'center', gap:12}},
          e('div', {style:{width:38, height:38, borderRadius:9, background:t.bg, border:`2px solid ${t.accent}`, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:17}}, t.icon),
          e('div', {style:{flex:1, minWidth:0}},
            e('div', {style:{fontSize:13, fontWeight:700, color:theme===t.id?v('accent'):v('text'), fontFamily:"var(--sans)"}}, t.name),
            e('div', {style:{fontSize:10.5, color:v('muted'), fontFamily:"var(--sans)"}}, t.desc),
          ),
          theme===t.id && e('span', {style:{color:v('accent'), fontSize:15}}, '✓'),
        ))
      ),
    ),

    // AI
    e('div', {style:T.sectionCard},
      e('div', {style:T.sectionTitle}, e('span', null, '🤖'), 'Inteligência Artificial'),

      // Modo autônomo
      e('div', {style:{marginBottom:18, padding:'14px 16px', background: autonomous ? v('accent-dim') : v('elevated'), border:`1px solid ${autonomous ? v('accent')+'50' : v('border')}`, borderRadius:11, transition:'all 0.2s'}},
        e('div', {onClick:()=>setAutonomous(a=>!a), style:{display:'flex', alignItems:'center', gap:12, cursor:'pointer'}},
          e('div', {style:{width:42, height:24, borderRadius:99, background: autonomous ? v('accent') : v('border'), position:'relative', flexShrink:0, transition:'background 0.2s'}},
            e('div', {style:{width:18, height:18, borderRadius:'50%', background:'#fff', position:'absolute', top:3, left: autonomous ? 21 : 3, transition:'left 0.2s', boxShadow:'0 1px 3px rgba(0,0,0,0.3)'}}),
          ),
          e('div', {style:{flex:1, minWidth:0}},
            e('div', {style:{fontSize:13.5, fontWeight:700, color: autonomous ? v('accent') : v('text'), fontFamily:"var(--sans)"}}, '⚡ Modo autônomo'),
            e('div', {style:{fontSize:11.5, color:v('muted'), fontFamily:"var(--sans)", marginTop:2}},
              'A IA decide sozinha quando buscar na web, ler páginas, calcular e memorizar'),
          ),
        ),
        autonomous && e('div', {style:{marginTop:12, paddingTop:12, borderTop:`1px solid ${v('border')}`, display:'flex', flexWrap:'wrap', gap:7}},
          Object.entries(TOOL_META).map(([k,m])=>e('span', {key:k,
            style:{display:'inline-flex', alignItems:'center', gap:5, padding:'4px 10px', borderRadius:99, background:v('card'), border:`1px solid ${v('border')}`, fontSize:11, color:v('text-s'), fontFamily:"var(--sans)", fontWeight:600}},
            e('span', null, m.icon), m.label)),
        ),
      ),
      // Banner explicando o failover
      e('div', {style:{marginBottom:18, padding:'12px 15px', background:v('accent-dim'), border:`1px solid ${v('accent')}30`, borderRadius:10, fontSize:12, color:v('text-s'), lineHeight:1.7, fontFamily:"var(--sans)"}},
        e('strong', {style:{color:v('accent')}}, '⚡ Failover automático: '),
        'configure duas ou mais chaves e o Nexus troca de provedor sozinho quando um atinge o limite — você nunca fica sem resposta.',
      ),

      // Chaves por provedor
      ...[
        {p:PROVIDERS.groq,       val:kGroq,       set:setKGroq,       ph:'gsk_…'},
        {p:PROVIDERS.cerebras,   val:kCerebras,   set:setKCerebras,   ph:'csk-…'},
        {p:PROVIDERS.gemini,     val:kGemini,     set:setKGemini,     ph:'cole sua chave do Gemini…'},
        {p:PROVIDERS.openrouter, val:kOpenRouter, set:setKOpenRouter, ph:'sk-or-…'},
      ].map(({p, val, set, ph}) => e('div', {key:p.id, style:{marginBottom:14}},
        e('div', {style:{display:'flex', alignItems:'center', gap:8, marginBottom:7}},
          e('label', {style:{...T.label, marginBottom:0}}, p.name + ' API Key'),
          val.trim() && e('span', {style:{fontSize:9.5, fontWeight:700, padding:'2px 8px', borderRadius:99, background:v('green-dim'), color:v('green'), fontFamily:"var(--sans)"}}, '● ATIVO'),
        ),
        e('input', {type:'password', value:val, onChange:ev=>set(ev.target.value), placeholder:ph,
          style:{...T.input, borderColor: val.trim() ? v('green')+'70' : v('border')}}),
        e('div', {style:{fontSize:11, color:v('muted'), marginTop:5, fontFamily:"var(--sans)"}},
          p.desc, ' · ',
          e('a', {href:p.console, target:'_blank', rel:'noopener', style:{color:v('accent'), textDecoration:'underline'}}, 'obter chave grátis'),
        ),
      )),

      // Chave de busca (não é provedor de IA)
      e('div', {style:{marginBottom:16, paddingTop:14, borderTop:`1px solid ${v('border')}`}},
        e('div', {style:{display:'flex', alignItems:'center', gap:8, marginBottom:7}},
          e('label', {style:{...T.label, marginBottom:0}}, 'Tavily — busca na web'),
          kTavily.trim() && e('span', {style:{fontSize:9.5, fontWeight:700, padding:'2px 8px', borderRadius:99, background:v('green-dim'), color:v('green'), fontFamily:"var(--sans)"}}, '● ATIVO'),
        ),
        e('input', {type:'password', value:kTavily, onChange:ev=>setKTavily(ev.target.value), placeholder:'tvly-…',
          style:{...T.input, borderColor: kTavily.trim() ? v('green')+'70' : v('border')}}),
        e('div', {style:{fontSize:11, color:v('muted'), marginTop:5, fontFamily:"var(--sans)"}},
          '1.000 buscas/mês grátis · ',
          e('a', {href:'https://app.tavily.com', target:'_blank', rel:'noopener', style:{color:v('accent'), textDecoration:'underline'}}, 'obter chave'),
          ' — sem ela, a IA funciona mas não pesquisa na internet',
        ),
      ),

      e('div', {style:{marginBottom:15, marginTop:4}},
        e('label', {style:T.label}, 'Modelo preferido'),
        e('select', {value:model, onChange:ev=>setModel(ev.target.value), style:{...T.input, cursor:'pointer'}},
          Object.values(PROVIDERS).map(p => e('optgroup', {key:p.id, label:p.name},
            MODELS.filter(m=>m.p===p.id).map(m=>e('option', {key:m.id, value:m.id}, m.label))
          ))
        ),
        e('div', {style:{fontSize:11, color:v('muted'), marginTop:5, fontFamily:"var(--sans)"}},
          'Se este modelo atingir o limite, o Nexus tenta automaticamente os demais provedores configurados.'),
      ),
      e('div', {style:{marginBottom:15}},
        e('label', {style:T.label}, 'Modo do Assistente'),
        e('select', {value:mode, onChange:ev=>setMode(ev.target.value), style:{...T.input, cursor:'pointer'}},
          e('option', {value:'academic'}, '🎓 Acadêmico — dissertações, ABNT'),
          e('option', {value:'institutional'}, '🏛 Institucional — ofícios, documentos'),
          e('option', {value:'research'}, '🔬 Pesquisa — metodologia, artigos'),
          e('option', {value:'technical'}, '💻 Técnico — código, arquitetura'),
          e('option', {value:'public'}, '⚖️ Pública — Lei 14.133, CGU/TCU'),
          e('option', {value:'general'}, '💬 Geral — uso livre'),
        ),
      ),
      e('div', null,
        e('label', {style:T.label}, 'Prompt do Sistema (opcional)'),
        e('textarea', {value:sys, onChange:ev=>setSys(ev.target.value), placeholder:'Personalize o comportamento da IA…', rows:3, style:{...T.input, resize:'vertical', lineHeight:1.6}}),
      ),
    ),

    // Memórias
    e('div', {style:T.sectionCard},
      e('div', {style:T.sectionTitle}, e('span', null, '🧠'), 'Memória'),
      e('div', {style:{fontSize:12, color:v('text-s'), marginBottom:14, fontFamily:"var(--sans)", lineHeight:1.7}},
        'Fatos que a IA guardou sobre você e seu trabalho. Ela consulta isso em toda conversa — por isso não precisa se reapresentar.'),
      (!mems || mems.length===0)
        ? e('div', {style:{padding:'22px 16px', textAlign:'center', background:v('elevated'), border:`1px dashed ${v('border')}`, borderRadius:10, fontSize:12.5, color:v('muted'), fontFamily:"var(--sans)", lineHeight:1.7}},
            'Nada memorizado ainda.',
            e('div', {style:{fontSize:11, marginTop:5, color:v('faint')}}, 'Diga algo como "sou diretor da Divisão de Patrimônio da UFPB" e a IA guardará sozinha.'))
        : e('div', {style:{display:'flex', flexDirection:'column', gap:7}},
            mems.map(m => e('div', {key:m.id,
              style:{display:'flex', alignItems:'flex-start', gap:10, padding:'10px 13px', background:v('elevated'), border:`1px solid ${v('border')}`, borderRadius:9}},
              e('span', {style:{fontSize:12, flexShrink:0, marginTop:1}}, '•'),
              e('div', {style:{flex:1, minWidth:0}},
                e('div', {style:{fontSize:12.5, color:v('text'), fontFamily:"var(--sans)", lineHeight:1.6}}, m.content),
                e('div', {style:{fontSize:10, color:v('faint'), fontFamily:"var(--sans)", marginTop:3}}, fmtDate(m.createdAt)),
              ),
              e('button', {onClick:()=>onDeleteMemory && onDeleteMemory(m.id), title:'Esquecer',
                style:{background:'none', border:'none', color:v('faint'), cursor:'pointer', fontSize:13, padding:'2px 5px', borderRadius:5, flexShrink:0, transition:'color 0.12s'},
                onMouseEnter:ev=>ev.currentTarget.style.color=v('red'),
                onMouseLeave:ev=>ev.currentTarget.style.color=v('faint')}, '🗑'),
            ))
          ),
    ),

    // Profile
    e('div', {style:T.sectionCard},
      e('div', {style:T.sectionTitle}, e('span', null, '👤'), 'Meu Perfil'),
      e('div', {style:{display:'grid', gridTemplateColumns:'1fr 1fr', gap:13, marginBottom:11}},
        e('div', null, e('label', {style:T.label}, 'Nome'), e('input', {value:name, onChange:ev=>setName(ev.target.value), style:T.input})),
        e('div', null, e('label', {style:T.label}, 'Email'), e('input', {type:'email', value:email, onChange:ev=>setEmail(ev.target.value), style:T.input})),
      ),
      e('div', {style:{fontSize:11.5, color:v('text-s'), fontFamily:"var(--sans)"}}, 'E-mail: ',
        e('code', {style:{fontFamily:"var(--mono)", color:v('accent'), background:v('elevated'), padding:'2px 8px', borderRadius:5}}, user.email),
        perfil?.papel==='admin' && e('span', {style:{marginLeft:9, padding:'2px 8px', borderRadius:99, background:v('accent-dim'), color:v('accent'), fontSize:9.5, fontWeight:700, fontFamily:"var(--sans)"}}, 'ADMIN'),
      ),
    ),

    // Password
    e('div', {style:T.sectionCard},
      e('div', {style:T.sectionTitle}, e('span', null, '🔑'), 'Alterar Senha'),
      e('div', {style:{display:'grid', gridTemplateColumns:'1fr 1fr', gap:13, marginBottom:13}},
        e('div', null, e('label', {style:T.label}, 'Nova senha'), e('input', {type:'password', value:newPass, onChange:ev=>setNewPass(ev.target.value), placeholder:'mínimo 6 caracteres', style:T.input})),
      ),
      passErr && e('div', {style:{padding:'8px 13px', background:v('red-dim'), border:`1px solid ${v('red')}40`, borderRadius:8, fontSize:11.5, color:v('red'), marginBottom:11, fontFamily:"var(--sans)"}}, '⚠ '+passErr),
      passOk && e('div', {style:{padding:'8px 13px', background:v('green-dim'), border:`1px solid ${v('green')}40`, borderRadius:8, fontSize:11.5, color:v('green'), marginBottom:11, fontFamily:"var(--sans)"}}, '✓ Senha alterada.'),
      e('button', {onClick:changePass,
        style:{padding:'10px 22px', borderRadius:9, border:`1px solid ${v('border')}`, cursor:'pointer', background:v('elevated'), color:v('text'), fontSize:12.5, fontWeight:600, fontFamily:"var(--sans)", transition:'all 0.15s'},
        onMouseEnter:ev=>{ev.currentTarget.style.borderColor=v('accent'); ev.currentTarget.style.color=v('accent');},
        onMouseLeave:ev=>{ev.currentTarget.style.borderColor=v('border'); ev.currentTarget.style.color=v('text');}
      }, 'Alterar senha'),
    ),

    e('button', {onClick:doSave,
      style:{...T.btnPrimary, width:'auto', padding:'13px 42px', background:saved?v('green'):`linear-gradient(135deg, ${v('accent-l')}, ${v('accent')}, ${v('accent-deep')})`, boxShadow:saved?'none':`0 8px 24px ${v('accent-glow')}`}},
      saved?'✓ Salvo com sucesso':'Salvar configurações'),
  );
}

// ── Admin View ────────────────────────────────────────────────────
function AdminView({currentUser}){
  const [perfis, setPerfis] = useState([]);
  const [uso, setUso] = useState({});
  const [filtro, setFiltro] = useState('todos');
  const [busca, setBusca] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [msg, setMsg] = useState('');

  const carregar = useCallback(async () => {
    setCarregando(true);
    const [ps, us] = await Promise.all([dbListarPerfis(), dbConsumoGeral()]);
    setPerfis(ps); setUso(us); setCarregando(false);
  }, []);

  useEffect(()=>{ carregar(); }, [carregar]);

  const aviso = (t) => { setMsg(t); setTimeout(()=>setMsg(''), 2500); };

  const alterar = async (id, campos) => {
    if(id === currentUser.id){ aviso('Você não pode alterar a própria conta aqui.'); return; }
    setPerfis(p => p.map(x => x.id===id ? {...x, ...campos} : x));
    await dbAtualizarPerfil(id, campos);
    aviso('Atualizado.');
  };

  const mudarLimite = async (p) => {
    const atual = p.limite_dia ?? 20;
    const novo = prompt(`Limite diário de mensagens para ${p.nome || 'este usuário'}:`, String(atual));
    if(novo === null) return;
    const n = parseInt(novo, 10);
    if(isNaN(n) || n < 0){ aviso('Informe um número válido.'); return; }
    await alterar(p.id, {limite_dia: n});
  };

  const lista = perfis.filter(p => {
    const ok = filtro==='todos'
      || (filtro==='admin' && p.papel==='admin')
      || (filtro==='user' && p.papel==='user')
      || (filtro==='inativos' && !p.ativo);
    const q = busca.toLowerCase();
    return ok && (!q || (p.nome||'').toLowerCase().includes(q));
  });

  const stats = {
    total: perfis.length,
    admins: perfis.filter(p=>p.papel==='admin').length,
    ativos: perfis.filter(p=>p.ativo).length,
    msgsHoje: Object.values(uso).reduce((s,u)=>s+(u.mensagens||0), 0),
  };

  return e('div', {style:{flex:1, overflowY:'auto', padding:28}},
    e('div', {style:{display:'flex', justifyContent:'space-between', alignItems:'flex-end', marginBottom:22, flexWrap:'wrap', gap:13}},
      e('div', null,
        e('div', {style:{fontFamily:"var(--display)", fontSize:32, fontWeight:700, color:v('text'), marginBottom:3, letterSpacing:'-0.6px'}}, 'Usuários e cotas'),
        e('div', {style:{fontSize:13, color:v('text-s'), fontFamily:"var(--sans)"}}, 'Defina o limite diário de cada pessoa individualmente'),
      ),
      e('button', {onClick:carregar,
        style:{padding:'10px 20px', borderRadius:9, border:`1px solid ${v('border')}`, cursor:'pointer', background:v('elevated'), color:v('text'), fontSize:12.5, fontWeight:600, fontFamily:"var(--sans)"}},
        '↻ Atualizar'),
    ),

    msg && e('div', {style:{marginBottom:16, padding:'10px 14px', background:v('green-dim'), border:`1px solid ${v('green')}40`, borderRadius:9, fontSize:12.5, color:v('green'), fontFamily:"var(--sans)"}}, msg),

    e('div', {style:{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:11, marginBottom:22}},
      [{l:'Usuários', v:stats.total, c:v('accent')},
       {l:'Admins', v:stats.admins, c:v('purple')},
       {l:'Ativos', v:stats.ativos, c:v('green')},
       {l:'Mensagens hoje', v:stats.msgsHoje, c:v('blue')}]
        .map((s,i)=>e('div', {key:i, style:{background:v('card'), border:`1px solid ${v('border')}`, borderRadius:11, padding:'14px 18px', boxShadow:`0 1px 3px ${v('shadow')}`}},
          e('div', {style:{fontSize:9.5, color:v('muted'), fontWeight:700, textTransform:'uppercase', letterSpacing:'1px', fontFamily:"var(--sans)", marginBottom:5}}, s.l),
          e('div', {style:{fontFamily:"var(--display)", fontSize:32, fontWeight:700, color:s.c}}, s.v),
        )),
    ),

    e('div', {style:{display:'flex', gap:8, marginBottom:15, flexWrap:'wrap', alignItems:'center'}},
      e('input', {value:busca, onChange:ev=>setBusca(ev.target.value), placeholder:'🔍 Buscar por nome…', style:{...T.input, flex:1, minWidth:220, padding:'8px 13px', fontSize:12.5}}),
      ...[['todos','Todos'], ['admin','Admins'], ['user','Usuários'], ['inativos','Inativos']].map(([f,l]) =>
        e('button', {key:f, onClick:()=>setFiltro(f),
          style:{padding:'7px 15px', borderRadius:8, cursor:'pointer', border:`1px solid ${filtro===f?v('accent')+'60':v('border')}`, background:filtro===f?v('accent-dim'):v('card'), color:filtro===f?v('accent'):v('text-s'), fontSize:11.5, fontWeight:600, fontFamily:"var(--sans)"}}, l)),
    ),

    e('div', {style:{background:v('card'), border:`1px solid ${v('border')}`, borderRadius:14, overflow:'hidden', boxShadow:`0 1px 3px ${v('shadow')}`}},
      e('div', {style:{display:'grid', gridTemplateColumns:'2fr 110px 130px 90px 90px', padding:'11px 20px', borderBottom:`1px solid ${v('border')}`, background:v('elevated'), fontSize:9, fontWeight:700, color:v('faint'), textTransform:'uppercase', letterSpacing:'1.2px', fontFamily:"var(--sans)"}},
        e('span', null, 'Nome'), e('span', null, 'Uso hoje'), e('span', null, 'Limite/dia'), e('span', null, 'Papel'), e('span', null, 'Status'),
      ),
      carregando
        ? e('div', {style:{padding:'40px', textAlign:'center', color:v('muted'), fontSize:13, fontFamily:"var(--sans)"}}, 'Carregando…')
        : lista.length===0
        ? e('div', {style:{padding:'40px 20px', textAlign:'center', color:v('muted'), fontSize:13.5, fontFamily:"var(--sans)"}}, 'Nenhum usuário encontrado')
        : lista.map((p,i) => {
            const u = uso[p.id] || {mensagens:0};
            const lim = p.limite_dia ?? 20;
            const pct = lim > 0 ? Math.min(100, Math.round((u.mensagens/lim)*100)) : 0;
            const eu = p.id === currentUser.id;
            return e('div', {key:p.id, style:{display:'grid', gridTemplateColumns:'2fr 110px 130px 90px 90px', alignItems:'center', padding:'12px 20px', borderBottom:i<lista.length-1?`1px solid ${v('border')}`:'none', opacity:p.ativo?1:0.5}},
              e('div', {style:{display:'flex', alignItems:'center', gap:10, minWidth:0}},
                e(Avatar, {role:'user', user:{name:p.nome}}),
                e('div', {style:{minWidth:0}},
                  e('div', {style:{fontSize:13, fontWeight:600, color:v('text'), fontFamily:"var(--sans)", overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}},
                    (p.nome || 'sem nome') + (eu ? ' (você)' : '')),
                  e('div', {style:{fontSize:10.5, color:v('faint'), fontFamily:"var(--sans)"}}, 'desde ' + fmtDate(new Date(p.criado_em).getTime())),
                ),
              ),
              e('div', null,
                e('div', {style:{fontSize:12, color:v('text'), fontFamily:"var(--mono)", fontWeight:600}}, `${u.mensagens}/${lim}`),
                e('div', {style:{height:4, background:v('border'), borderRadius:99, marginTop:4, overflow:'hidden'}},
                  e('div', {style:{height:'100%', width:pct+'%', background: pct>85?v('red'):pct>60?v('accent'):v('green'), transition:'width 0.3s'}})),
              ),
              e('button', {onClick:()=>mudarLimite(p), disabled:eu,
                style:{padding:'5px 12px', borderRadius:7, border:`1px solid ${v('border')}`, background:v('elevated'), color:eu?v('faint'):v('text'), fontSize:11.5, fontWeight:600, cursor:eu?'not-allowed':'pointer', fontFamily:"var(--sans)", width:'fit-content'},
                onMouseEnter:ev=>{if(!eu){ev.currentTarget.style.borderColor=v('accent'); ev.currentTarget.style.color=v('accent');}},
                onMouseLeave:ev=>{ev.currentTarget.style.borderColor=v('border'); ev.currentTarget.style.color=eu?v('faint'):v('text');}},
                `${lim} ✎`),
              e('span', {onClick:()=>!eu && alterar(p.id, {papel: p.papel==='admin'?'user':'admin'}),
                style:{padding:'3px 10px', borderRadius:6, fontSize:10.5, fontWeight:700, fontFamily:"var(--sans)", cursor:eu?'not-allowed':'pointer', width:'fit-content',
                  background:p.papel==='admin'?v('purple-dim'):v('blue-dim'), color:p.papel==='admin'?v('purple'):v('blue'),
                  border:`1px solid ${p.papel==='admin'?v('purple')+'40':v('blue')+'40'}`}},
                p.papel==='admin'?'ADMIN':'USER'),
              e('span', {onClick:()=>!eu && alterar(p.id, {ativo: !p.ativo}),
                style:{padding:'3px 10px', borderRadius:6, fontSize:10.5, fontWeight:700, fontFamily:"var(--sans)", cursor:eu?'not-allowed':'pointer', width:'fit-content',
                  background:p.ativo?v('green-dim'):v('red-dim'), color:p.ativo?v('green'):v('red'),
                  border:`1px solid ${p.ativo?v('green')+'40':v('red')+'40'}`}},
                p.ativo?'ATIVO':'INATIVO'),
            );
          })
    ),

    e('div', {style:{marginTop:18, padding:'13px 16px', background:v('accent-dim'), border:`1px solid ${v('accent')}30`, borderRadius:10, fontSize:11.5, color:v('text-s'), fontFamily:"var(--sans)", lineHeight:1.8}},
      e('strong', {style:{color:v('accent')}}, 'Como usar: '),
      'clique no limite para ajustar a cota daquela pessoa. Clique no papel para promover a admin, ou no status para suspender. ',
      'Quem configurar a própria chave de IA nas Configurações deixa de consumir a cota compartilhada e passa a não ter limite.',
    ),
  );
}


// ═══════════════════════════════════════════════════════════════
// APP PRINCIPAL
// ═══════════════════════════════════════════════════════════════
function NexusIA(){
  const [theme, setTheme] = useState(()=>ld(K_THEME, 'dark'));
  const [sessao, setSessao] = useState(undefined);    // undefined = verificando
  const [perfil, setPerfil] = useState(null);
  const [cota, setCota] = useState({usadas:0, limite:20});
  const [cfg, setCfg] = useState(()=>ld(K_CFG, {model:DEFAULT_MODEL, mode:'academic', systemPrompt:'', autonomous:true}));
  const [convs, setConvs] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [docs, setDocs] = useState([]);
  const [mems, setMems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState('chat');
  const [cloudStatus, setCloudStatus] = useState('checking');

  useEffect(()=>{ applyTheme(theme); }, [theme]);
  const handleChangeTheme = useCallback((t)=>setTheme(t), []);

  // Sessão do Supabase — restaura sozinha ao recarregar a página
  useEffect(()=>{
    SB.auth.getSession().then(({data}) => setSessao(data.session || null));
    const {data:sub} = SB.auth.onAuthStateChange((_evt, s) => setSessao(s || null));
    return () => sub?.subscription?.unsubscribe();
  }, []);

  const currentUser = sessao?.user || null;

  // Carrega tudo do usuário logado
  const recarregar = useCallback(async () => {
    if(!currentUser) return;
    try{
      const [p, cv, dc, mm, pr, cs] = await Promise.all([
        dbPerfil(), dbConversas(), dbDocumentos(), dbMemorias(),
        dbPreferencias(), dbConsumoHoje(currentUser.id),
      ]);
      setPerfil(p);
      setConvs(cv); setActiveId(cv[0]?.id || null);
      setDocs(dc); setMems(mm);
      if(pr) setCfg(c => ({...c, ...pr}));
      setCota({usadas: cs.mensagens || 0, limite: p?.limite_dia ?? 20});
      setCloudStatus('online');
    }catch(err){
      console.warn('[recarregar]', err);
      setCloudStatus('offline');
    }
  }, [currentUser?.id]);

  useEffect(()=>{ if(currentUser) recarregar(); }, [currentUser?.id]);
  useEffect(()=>{sv(K_CFG, cfg);}, [cfg]);


  const activeConv = convs.find(c=>c.id===activeId) || null;

  const handleLogin = useCallback(() => { setView('chat'); }, []);

  const handleLogout = useCallback(async () => {
    await auSair();
    setConvs([]); setDocs([]); setMems([]); setActiveId(null); setPerfil(null);
  }, []);

  const handleSaveNome = useCallback(async (nome) => {
    if(!currentUser) return;
    await dbAtualizarPerfil(currentUser.id, {nome});
    setPerfil(p => p ? {...p, nome} : p);
  }, [currentUser]);

  const handleSaveCfg = useCallback(newCfg => {
    setCfg(newCfg);
    if(currentUser) dbSalvarPreferencias(currentUser.id, newCfg);
  }, [currentUser]);

  const newConv = useCallback(() => {
    const c = {id:crypto.randomUUID(), title:'Nova conversa', messages:[], createdAt:Date.now(), updatedAt:Date.now()};
    setConvs(p=>[c, ...p]); setActiveId(c.id); setView('chat'); return c;
  }, []);

  const deleteConv = useCallback(id => {
    setConvs(p=>p.filter(c=>c.id!==id));
    setActiveId(p=>p===id?convs.find(c=>c.id!==id)?.id||null:p);
    dbApagarConversa(id);
  }, [convs]);

  const clearConv = useCallback(() => {
    if(!activeConv) return;
    const cleared = {...activeConv, messages:[], title:'Nova conversa', updatedAt:Date.now()};
    setConvs(p=>p.map(c=>c.id===activeConv.id?cleared:c));
    if(currentUser) dbSalvarConversa(cleared, currentUser.id);
  }, [activeConv, currentUser]);

  const addMemory = useCallback(async (fato) => {
    const m = {id:crypto.randomUUID(), content:String(fato).slice(0,400), createdAt:Date.now()};
    let novo = false;
    setMems(p => {
      if(p.some(x => x.content.toLowerCase() === m.content.toLowerCase())) return p;
      novo = true;
      return [m, ...p].slice(0, 60);
    });
    if(currentUser && novo) dbSalvarMemoria(m, currentUser.id);
  }, [currentUser]);

  const deleteMemory = useCallback(id => {
    setMems(p => p.filter(x => x.id !== id));
    dbApagarMemoria(id);
  }, []);

  const deleteDoc = useCallback(id => {
    setDocs(p=>p.filter(d=>d.id!==id));
    dbApagarDocumento(id);
  }, []);

  const downloadDoc = useCallback(d => {
    const md = `# ${d.name}\n\n_${fmtDate(d.createdAt)}_\n\n---\n\n${d.content}`;
    const b = new Blob([md], {type:'text/markdown'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = `${d.name.slice(0,50).replace(/[^a-z0-9]/gi, '-')}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, []);

  const handleSend = useCallback(async (rawText, attached) => {
    const atts = attached || [];
    if(loading) return;
    if(rawText.trim()==='/limpar'){ clearConv(); return; }
    if(rawText.trim()==='/ajuda'){
      let conv = activeConv || {id:crypto.randomUUID(), title:'Ajuda', messages:[], createdAt:Date.now(), updatedAt:Date.now()};
      const help = SLASH_COMMANDS.map(c=>`**${c.cmd}** — ${c.desc}`).join('\n');
      const msgs = [...conv.messages,
        {id:uid(), role:'user', content:'/ajuda', timestamp:Date.now()},
        {id:uid(), role:'assistant', content:'## Comandos disponíveis\n\n'+help+'\n\n*Digite `/` para autocompletar.*', timestamp:Date.now()}];
      const upd = {...conv, messages:msgs, updatedAt:Date.now()};
      setConvs(p=>{const ex=p.find(c=>c.id===upd.id); return ex?p.map(c=>c.id===upd.id?upd:c):[upd, ...p];});
      setActiveId(upd.id);
      if(currentUser) dbSalvarConversa(upd, currentUser.id);
      return;
    }
    const tools = toolsForSlash(rawText);
    let text = expandSlash(rawText);
    if(atts.length){
      const blocks = atts.map(f =>
        `<arquivo nome="${f.name}">\n${f.content}\n</arquivo>`).join('\n\n');
      text = `${blocks}\n\n---\n\nCom base no(s) arquivo(s) acima: ${text}`;
    }
    let sys = cfg.systemPrompt || SYSTEM_PROMPTS[cfg.mode] || SYSTEM_PROMPTS.general;
    if(mems.length){
      sys += `\n\nO QUE VOCÊ JÁ SABE SOBRE ESTE USUÁRIO:\n` +
             mems.slice(0,30).map(m=>`- ${m.content}`).join('\n') +
             `\nUse esses fatos naturalmente, sem anunciar que os consultou.`;
    }
    let conv = activeConv || {id:crypto.randomUUID(), title:genTitle(rawText), messages:[], createdAt:Date.now(), updatedAt:Date.now()};
    const userMsg = {id:uid(), role:'user', content:rawText, tools, timestamp:Date.now(), files: atts.map(f=>({name:f.name, size:f.size, ext:f.ext}))};
    const aiId = uid();
    const aiMsg = {id:aiId, role:'assistant', content:'', timestamp:Date.now()};
    const upd = {...conv, title:conv.messages.length===0?genTitle(rawText):conv.title, messages:[...conv.messages, userMsg, aiMsg], updatedAt:Date.now()};
    setConvs(p=>{const ex=p.find(c=>c.id===upd.id); return ex?p.map(c=>c.id===upd.id?upd:c):[upd, ...p];});
    setActiveId(upd.id); setLoading(true);
    const history = [...conv.messages.slice(-12), {role:'user', content:text}].map(m=>({role:m.role, content:m.content}));
    try {
      let final = '';
      final = await runAgent(cfg.model||DEFAULT_MODEL, history, sys,
        {autonomous: cfg.autonomous !== false, onRemember: addMemory},
        partial => {
          final = partial;
          setConvs(p=>p.map(c=>c.id===upd.id?{...c, messages:c.messages.map(m=>m.id===aiId?{...m, content:partial, toolsDone:true}:m)}:c));
        },
        (call) => {
          // Mostra a ferramenta em execução dentro da própria mensagem
          setConvs(p=>p.map(c=>c.id===upd.id?{...c, messages:c.messages.map(m=>{
            if(m.id!==aiId) return m;
            const meta = TOOL_META[call.name] || {icon:'⚙', label:call.name};
            const prev = (m.ranTools||[]).filter(t=>t.name!==call.name || t.argsKey!==JSON.stringify(call.args));
            return {...m, ranTools:[...prev, {
              name:call.name, icon:meta.icon, label:meta.label,
              detail:Object.values(call.args||{})[0] || '',
              done:call.done, argsKey:JSON.stringify(call.args),
            }]};
          })}:c));
        },
        (newModel, prov) => {
          setConvs(p=>p.map(c=>c.id===upd.id?{...c, messages:c.messages.map(m=>m.id===aiId?{...m, switched:{model:newModel, provider:prov.name}}:m)}:c));
        }
      );
      if(final.length > 400){
        const doc = {id:crypto.randomUUID(), name:genTitle(rawText), content:final, type:docType(final, rawText), createdAt:Date.now()};
        setDocs(p=>[doc, ...p]);
        setConvs(p=>p.map(c=>c.id===upd.id?{...c, messages:c.messages.map(m=>m.id===aiId?{...m, savedDoc:doc}:m)}:c));
        if(currentUser) dbSalvarDocumento(doc, currentUser.id);
      }
      if(currentUser){
        setTimeout(()=>{ setConvs(p=>{ const latest=p.find(c=>c.id===upd.id); if(latest) dbSalvarConversa(latest, currentUser.id); return p; }); }, 120);
      }
    } catch(err) {
      const msg = err.message || '';
      let friendlyMsg = `❌ **Erro:** ${msg}`;
      if(err.tipo === 'cota'){
        friendlyMsg = `🕐 **Cota diária esgotada**\n\n${msg}`;
        if(err.cota?.limite) setCota({usadas:err.cota.usadas, limite:err.cota.limite});
      } else if(err.tipo === 'indisponivel'){
        friendlyMsg = `⏱ **Provedores ocupados**\n\n${msg}`;
      }
      setConvs(p=>p.map(c=>c.id===upd.id?{...c, messages:c.messages.map(m=>m.id===aiId?{...m, content:friendlyMsg}:m)}:c));
      setLoading(false);
      return;
    }
    setCota(c => ({...c, usadas: c.usadas + 1}));
    setLoading(false);
  }, [activeConv, loading, cfg, clearConv, currentUser, mems, addMemory]);

  if(sessao === undefined) return e('div', {style:{height:'100vh', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:14}},
    e('div', {style:{fontFamily:"var(--display)", fontSize:40, fontWeight:700, color:v('accent')}}, 'Nexus IA'),
    e('div', {style:{width:90, height:2, background:v('border'), borderRadius:99, overflow:'hidden'}},
      e('div', {style:{height:'100%', background:v('accent'), animation:'loadBar 1.2s ease infinite'}})),
  );
  if(!currentUser) return e(LoginScreen, {onLogin:handleLogin, theme, onChangeTheme:handleChangeTheme});

  return e('div', {style:{display:'flex', height:'100vh', overflow:'hidden'}},
    e(Sidebar, {user:currentUser, perfil, cota, convs, activeId, onSelect:setActiveId, onNew:newConv, onDelete:deleteConv, view, onView:setView, onLogout:handleLogout, cloudStatus}),
    view==='chat' ? e(ChatView, {user:currentUser, conv:activeConv, cfg, onSend:handleSend, loading, onClear:clearConv, theme, onChangeTheme:handleChangeTheme}) : null,
    view==='arquivo' ? e(ArquivoView, {docs, onDelete:deleteDoc, onDownload:downloadDoc}) : null,
    view==='settings' ? e(SettingsView, {user:currentUser, perfil, cota, cfg, onSave:handleSaveCfg, onSaveNome:handleSaveNome, theme, onChangeTheme:handleChangeTheme, mems, onDeleteMemory:deleteMemory}) : null,
    view==='admin' && perfil?.papel==='admin' ? e(AdminView, {currentUser}) : null,
  );
}

window.__NexusIA = NexusIA;
