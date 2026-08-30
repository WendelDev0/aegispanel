import React, { useState } from 'react';
import {
  HelpCircle,
  Copy,
  Check,
  Bot,
  Sparkles,
  Zap,
  Code2,
  FileCode,
  CheckCircle2,
  AlertTriangle,
  Server,
  ArrowRight,
  ShieldCheck,
  Cpu,
  RefreshCw
} from 'lucide-react';

export const HelpPage: React.FC = () => {
  const [selectedStack, setSelectedStack] = useState<string>('universal');
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copiedCustom, setCopiedCustom] = useState(false);

  const stackPrompts: Record<string, { title: string; desc: string; prompt: string }> = {
    universal: {
      title: 'Prompt Universal (Adaptar qualquer projeto Vercel para AegisPanel)',
      desc: 'Use este prompt em qualquer IA (ChatGPT, Claude, Cursor, v0) para converter seu projeto feito para a Vercel em um projeto pronto para deploy conteinerizado no AegisPanel.',
      prompt: `Estou hospedando meu projeto no painel AegisPanel (uma plataforma Cloud PaaS que roda em VPS Linux com Docker e Caddy).
A maioria dos meus projetos foi inicialmente desenvolvida para a Vercel, mas agora preciso que você adapte e prepare todo o código para rodar no AegisPanel sem nenhum erro de build ou deploy.

Por favor, faça as seguintes verificações e ajustes necessários no meu código:

1. SCRIPTS NO PACKAGE.JSON:
   - Certifique-se de que os scripts "build" e "start" existem e funcionam corretamente.
   - O script "start" deve iniciar o servidor de produção (ex: "next start", "node dist/index.js", etc.).
   - Se for uma SPA (Vite/React), certifique-se de que "build" gera a pasta "dist".

2. HOST E PORTA (BINDING):
   - Certifique-se de que o servidor escuta no host '0.0.0.0' (e NÃO apenas em 'localhost' ou '127.0.0.1').
   - Use a porta fornecida pela variável de ambiente: \`process.env.PORT || 3000\`.

3. DEPENDÊNCIAS E COMPATIBILIDADE:
   - Mova ferramentas de compilação essenciais (como typescript, vite, tailwindcss, etc.) para "dependencies" ou garanta que "devDependencies" sejam instaladas no build.
   - Substitua quaisquer dependências ou adaptadores exclusivos da Vercel Edge/Serverless por equivalentes universais padrão Node.js.

4. VARIÁVEIS DE AMBIENTE:
   - Liste quais variáveis de ambiente (.env) meu projeto precisa para funcionar em produção.

Revise meus arquivos de configuração e me entregue o código pronto para eu commitar no Git e fazer o deploy no AegisPanel!`
    },
    nextjs: {
      title: 'Next.js (App Router & Pages Router)',
      desc: 'Otimizações essenciais para Next.js rodar com alta performance e sem travas no AegisPanel.',
      prompt: `Estou hospedando minha aplicação Next.js no AegisPanel (VPS Docker PaaS).
Por favor, prepare meu projeto Next.js para rodar perfeitamente fora da Vercel:

1. NEXT.CONFIG.JS:
   - Adicione \`output: 'standalone'\` no \`next.config.js\` (ou \`next.config.mjs\`) para builds ultraleves.
   - Certifique-se de que não há dependências de Vercel Serverless Functions proprietárias.

2. SCRIPTS NO PACKAGE.JSON:
   - "scripts": {
       "build": "next build",
       "start": "next start -H 0.0.0.0 -p \${PORT:-3000}"
     }

3. VARIÁVEIS DE AMBIENTE:
   - Variáveis públicas devem iniciar com \`NEXT_PUBLIC_\`.
   - Liste todas as variáveis necessárias para produção.

Me entregue as alterações prontas para que o deploy no AegisPanel suba de primeira!`
    },
    vite: {
      title: 'Vite / React / Vue / Svelte (SPA)',
      desc: 'Garante que o build gere os assets corretos e rotas do React Router funcionem sem erro 404.',
      prompt: `Estou hospedando meu frontend SPA (Vite/React) no AegisPanel.
O AegisPanel compila o projeto com "npm run build" e serve a pasta "dist".

Por favor, faça as seguintes verificações:
1. VITE.CONFIG:
   - Certifique-se de que \`base: '/'\` está configurado para rotas absolutas.
   - Verifique se não há variáveis de ambiente secretas expostas no build (use \`VITE_\` para as públicas).

2. PACKAGE.JSON:
   - Verifique se "build" executa "vite build" ou "tsc && vite build".
   - Verifique se todas as bibliotecas usadas nos componentes estão presentes nas dependências.

3. ROTAS:
   - Se uso react-router-dom, garanta que não há caminhos relativos quebrados.

Entregue o código ajustado para deploy imediato no AegisPanel!`
    },
    nodeapi: {
      title: 'Node.js / Express / Fastify / NestJS API',
      desc: 'Ajuste de portas dinâmicas, host 0.0.0.0 e tratamento de encerramento seguro.',
      prompt: `Estou hospedando minha API Backend (Node.js) no AegisPanel.
Por favor, revise o código do servidor para garantir que ele rode no Docker:

1. BINDING DO SERVIDOR:
   - O servidor DEVE escutar em \`0.0.0.0\` (ex: \`app.listen(PORT, '0.0.0.0', ...)\` ou \`fastify.listen({ port: PORT, host: '0.0.0.0' })\`).
   - A porta deve ser dinâmica: \`const PORT = process.env.PORT || 3000;\`.

2. SCRIPT DE START:
   - Se o projeto usa TypeScript, garanta que o script "build" compila para "dist" e o "start" executa "node dist/index.js" (ou "node server.js").

3. BANCO DE DADOS:
   - Suporte a conexões via variável \`DATABASE_URL\` para os bancos PostgreSQL/MySQL criados no AegisPanel.

Me forneça as correções necessárias para fazer o commit e deploy!`
    }
  };

  const copyToClipboard = (text: string, isCustom = false) => {
    navigator.clipboard.writeText(text);
    if (isCustom) {
      setCopiedCustom(true);
      setTimeout(() => setCopiedCustom(false), 2000);
    } else {
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2000);
    }
  };

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2.5">
          <HelpCircle className="w-6 h-6 text-primary" />
          Central de Ajuda & Assistente de Prompts para IAs
        </h2>
        <p className="text-sm text-on-surface-variant mt-1">
          Copie os prompts prontos e envie para a sua IA (ChatGPT, Claude, Cursor, v0) preparar seu código e garantir deploys 100% perfeitos no AegisPanel.
        </p>
      </div>

      {/* Stack Selector Pills */}
      <div className="flex flex-wrap gap-2.5">
        {[
          { id: 'universal', label: 'Universal (Vercel ➔ Aegis)', icon: Sparkles },
          { id: 'nextjs', label: 'Next.js', icon: Zap },
          { id: 'vite', label: 'Vite / React SPA', icon: Code2 },
          { id: 'nodeapi', label: 'Express / Nest / Node API', icon: Server },
        ].map((tab) => {
          const Icon = tab.icon;
          const isSelected = selectedStack === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setSelectedStack(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold border transition-all ${
                isSelected
                  ? 'bg-primary-container border-primary text-white'
                  : 'bg-surface-container border-outline-variant text-on-surface-variant hover:bg-surface-container-high/80 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Main Prompt Box */}
      <div className="bg-surface-container/95 rounded-lg p-6 border border-primary/30 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-white text-base flex items-center gap-2">
              <Bot className="w-5 h-5 text-primary" />
              {stackPrompts[selectedStack]?.title}
            </h3>
            <p className="text-xs text-on-surface-variant mt-0.5">
              {stackPrompts[selectedStack]?.desc}
            </p>
          </div>

          <button
            onClick={() => copyToClipboard(stackPrompts[selectedStack]?.prompt)}
            className="flex items-center gap-2 px-4 py-2.5 rounded bg-primary-container hover:from-indigo-500 hover:to-emerald-500 text-white font-semibold text-xs transition-all active:scale-95 shrink-0"
          >
            {copiedPrompt ? (
              <>
                <Check className="w-4 h-4 text-white" />
                <span>Prompt Copiado com Sucesso!</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                <span>Copiar Prompt para Minha IA</span>
              </>
            )}
          </button>
        </div>

        {/* Prompt Content */}
        <div className="relative">
          <textarea
            readOnly
            rows={12}
            value={stackPrompts[selectedStack]?.prompt}
            className="w-full bg-surface-container-lowest/90 border border-outline-variant rounded-lg p-4 text-xs font-mono text-on-surface focus:outline-none select-all custom-scrollbar leading-relaxed"
          />
        </div>
      </div>

      {/* Checklist de Compatibilidade */}
      <div className="bg-surface-container rounded-lg p-6 border border-outline-variant space-y-4">
        <h3 className="font-bold text-white text-base flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-ok" />
          Checklist Rápido: Vercel vs AegisPanel
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="p-4 rounded-lg bg-surface-container-lowest border border-outline-variant space-y-2">
            <div className="flex items-center gap-2 text-primary font-bold text-sm">
              <Cpu className="w-4 h-4" />
              <span>1. Host & Portas</span>
            </div>
            <p className="text-on-surface-variant">
              Na Vercel, a porta é gerenciada automaticamente por funções serverless. No AegisPanel, seu servidor Node/API deve escutar em <strong className="text-ok font-mono">0.0.0.0</strong> usando <strong className="text-primary font-mono">process.env.PORT</strong>.
            </p>
          </div>

          <div className="p-4 rounded-lg bg-surface-container-lowest border border-outline-variant space-y-2">
            <div className="flex items-center gap-2 text-primary font-bold text-sm">
              <FileCode className="w-4 h-4" />
              <span>2. Scripts no Package.json</span>
            </div>
            <p className="text-on-surface-variant">
              Certifique-se de que o <strong className="text-white font-mono">"scripts"</strong> do seu <strong className="text-white font-mono">package.json</strong> possui um comando <strong className="text-primary font-mono">"build"</strong> e um comando <strong className="text-ok font-mono">"start"</strong> claros.
            </p>
          </div>

          <div className="p-4 rounded-lg bg-surface-container-lowest border border-outline-variant space-y-2">
            <div className="flex items-center gap-2 text-primary font-bold text-sm">
              <Zap className="w-4 h-4" />
              <span>3. Next.js Standalone</span>
            </div>
            <p className="text-on-surface-variant">
              Para projetos Next.js, adicione <strong className="text-warn font-mono">output: 'standalone'</strong> no seu <strong className="text-white font-mono">next.config.js</strong> para compilação super rápida com menos consumo de RAM.
            </p>
          </div>

          <div className="p-4 rounded-lg bg-surface-container-lowest border border-outline-variant space-y-2">
            <div className="flex items-center gap-2 text-primary font-bold text-sm">
              <CheckCircle2 className="w-4 h-4" />
              <span>4. SPAs (Vite / React)</span>
            </div>
            <p className="text-on-surface-variant">
              Projetos Vite/React são detectados automaticamente pelo AegisPanel e servidos com alta velocidade através do servidor integrado com Healthcheck ativo.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
