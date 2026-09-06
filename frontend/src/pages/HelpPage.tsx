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
  Server,
  ShieldCheck,
  Cpu,
  Layers,
  Package,
} from 'lucide-react';
import { Panel, SectionHeader } from '../components/ui.js';
import {
  DEFAULT_HELP_STACK_ID,
  findHelpStack,
  stacksForFamily,
  type HelpFamily,
} from './helpStacks.js';

const FAMILY_TABS: { id: HelpFamily; label: string; hint: string }[] = [
  { id: 'node', label: 'Node / frontend', hint: 'Vercel, Next, Vite, Express' },
  { id: 'python', label: 'Python', hint: 'Flask, FastAPI, Django' },
];

const STACK_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  universal: Sparkles,
  nextjs: Zap,
  vite: Code2,
  nodeapi: Server,
  python: Package,
  fastapi: Zap,
  django: Layers,
  flask: FileCode,
};

export const HelpPage: React.FC = () => {
  const [selectedStack, setSelectedStack] = useState(DEFAULT_HELP_STACK_ID);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  const current = findHelpStack(selectedStack);
  const family = current.family;
  const familyStacks = stacksForFamily(family);

  const selectFamily = (next: HelpFamily) => {
    if (next === family) return;
    const first = stacksForFamily(next)[0];
    if (first) setSelectedStack(first.id);
  };

  const copyPrompt = () => {
    void navigator.clipboard.writeText(current.prompt);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  };

  return (
    <div className="space-y-8 max-w-5xl">
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2.5">
          <HelpCircle className="w-6 h-6 text-primary" />
          Central de Ajuda
        </h2>
        <p className="text-sm text-on-surface-variant mt-1">
          O AegisPanel hospeda Node, SPAs e Python (Flask, FastAPI, Django) no mesmo fluxo de Git + Docker.
          Copie um prompt para a sua IA ou siga o checklist do runtime.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FAMILY_TABS.map((tab) => {
          const selected = family === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              aria-label={tab.label}
              aria-pressed={selected}
              onClick={() => selectFamily(tab.id)}
              className={`px-4 py-2.5 rounded-lg text-xs font-semibold border transition-all text-left ${
                selected
                  ? 'bg-primary-container border-primary text-white'
                  : 'bg-surface-container border-outline-variant text-on-surface-variant hover:bg-surface-container-high/80 hover:text-white'
              }`}
            >
              <span className="block">{tab.label}</span>
              <span className={`block text-[10px] font-medium mt-0.5 ${selected ? 'text-white/70' : 'text-on-surface-variant/80'}`}>
                {tab.hint}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2.5">
        {familyStacks.map((stack) => {
          const Icon = STACK_ICONS[stack.id] ?? FileCode;
          const isSelected = selectedStack === stack.id;
          return (
            <button
              key={stack.id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => setSelectedStack(stack.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold border transition-all ${
                isSelected
                  ? 'bg-primary-container border-primary text-white'
                  : 'bg-surface-container border-outline-variant text-on-surface-variant hover:bg-surface-container-high/80 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{stack.label}</span>
            </button>
          );
        })}
      </div>

      <Panel className="p-6 border-primary/30 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <SectionHeader
            icon={<Bot className="w-5 h-5" />}
            title={current.title}
            subtitle={current.desc}
          />
          <button
            type="button"
            onClick={copyPrompt}
            className="flex items-center gap-2 px-4 py-2.5 rounded bg-primary-container text-white font-semibold text-xs transition-all active:scale-95 shrink-0"
          >
            {copiedPrompt ? (
              <>
                <Check className="w-4 h-4 text-white" />
                <span>Prompt copiado com sucesso!</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                <span>Copiar prompt para minha IA</span>
              </>
            )}
          </button>
        </div>
        <textarea
          readOnly
          rows={12}
          aria-label={`Prompt ${current.label}`}
          value={current.prompt}
          className="w-full bg-surface-container-lowest/90 border border-outline-variant rounded-lg p-4 text-xs font-mono text-on-surface focus:outline-none select-all custom-scrollbar leading-relaxed"
        />
      </Panel>

      {family === 'python' ? <PythonGuide /> : <NodeChecklist />}
    </div>
  );
};

const NodeChecklist: React.FC = () => (
  <Panel className="p-6 space-y-4">
    <SectionHeader
      icon={<ShieldCheck className="w-5 h-5" />}
      title="Checklist: Vercel vs AegisPanel"
      subtitle="O que muda quando o app deixa de ser serverless e vira container."
    />
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
      <GuideCard icon={Cpu} title="1. Host e portas">
        Na Vercel a porta é da função serverless. No Aegis o servidor Node deve escutar em{' '}
        <strong className="text-ok font-mono">0.0.0.0</strong> usando{' '}
        <strong className="text-primary font-mono">process.env.PORT</strong>.
      </GuideCard>
      <GuideCard icon={FileCode} title="2. Scripts no package.json">
        O <strong className="text-white font-mono">package.json</strong> precisa de{' '}
        <strong className="text-primary font-mono">build</strong> e{' '}
        <strong className="text-ok font-mono">start</strong> claros.
      </GuideCard>
      <GuideCard icon={Zap} title="3. Next.js standalone">
        Adicione <strong className="text-warn font-mono">output: &apos;standalone&apos;</strong> no{' '}
        <strong className="text-white font-mono">next.config</strong> para imagem menor e menos RAM.
      </GuideCard>
      <GuideCard icon={CheckCircle2} title="4. SPAs (Vite / React)">
        Vite/React são detectados e servidos pela pasta <span className="font-mono">dist</span> com healthcheck.
      </GuideCard>
    </div>
  </Panel>
);

const PythonGuide: React.FC = () => (
  <div className="space-y-6">
    <Panel className="p-6 space-y-4">
      <SectionHeader
        icon={<Package className="w-5 h-5" />}
        title="Como o Aegis hospeda Python"
        subtitle="O detector propõe. O aegis.toml decide. Você confirma no painel."
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
        <GuideCard icon={FileCode} title="Detecção automática">
          Reconhece <span className="font-mono text-white">requirements.txt</span>,{' '}
          <span className="font-mono text-white">pyproject.toml</span>,{' '}
          <span className="font-mono text-white">Pipfile</span>,{' '}
          <span className="font-mono text-white">uv.lock</span> e arquivos{' '}
          <span className="font-mono text-white">*.py</span>. Frameworks:{' '}
          <strong className="text-white">Flask</strong>, <strong className="text-white">FastAPI</strong> e{' '}
          <strong className="text-white">Django</strong>.
        </GuideCard>
        <GuideCard icon={Layers} title="Gerenciadores e versão">
          Instala com <strong className="text-white">pip</strong>, <strong className="text-white">poetry</strong>,{' '}
          <strong className="text-white">uv</strong> ou <strong className="text-white">pipenv</strong>. Python{' '}
          <strong className="text-primary font-mono">3.10–3.13</strong> (padrão 3.12). Respeita{' '}
          <span className="font-mono">requires-python</span> do pyproject.
        </GuideCard>
        <GuideCard icon={Cpu} title="Host, porta e start">
          Sempre <strong className="text-ok font-mono">0.0.0.0</strong>. FastAPI/Django usam porta{' '}
          <strong className="text-primary font-mono">8000</strong> (uvicorn / gunicorn). Flask costuma usar{' '}
          <strong className="text-primary font-mono">5000</strong>. Inclua gunicorn ou uvicorn nas dependências.
        </GuideCard>
        <GuideCard icon={ShieldCheck} title="Release, worker e banco">
          Django: <span className="font-mono text-white">migrate</span> no processo{' '}
          <strong className="text-white">release</strong>, não no start. Celery/RQ sobe como worker da mesma
          imagem. Bancos do painel entram por <span className="font-mono">DATABASE_URL</span>.
        </GuideCard>
      </div>
    </Panel>

    <Panel className="p-6 space-y-3">
      <SectionHeader
        icon={<CheckCircle2 className="w-5 h-5" />}
        title="Checklist rápido Python"
        subtitle="O que costuma quebrar o primeiro deploy."
      />
      <ul className="text-xs text-on-surface-variant space-y-2 leading-relaxed">
        <li>
          • O app escuta em <span className="font-mono text-ok">0.0.0.0</span> e lê{' '}
          <span className="font-mono text-primary">PORT</span>.
        </li>
        <li>
          • Há manifesto de dependências e o servidor de produção (gunicorn ou uvicorn) está listado nele.
        </li>
        <li>
          • FastAPI exporta <span className="font-mono text-white">app</span> em{' '}
          <span className="font-mono text-white">main.py</span> (healthcheck em <span className="font-mono">/docs</span>).
        </li>
        <li>
          • Django: módulo WSGI correto (o padrão do detector é{' '}
          <span className="font-mono text-white">core.wsgi:application</span>) e{' '}
          <span className="font-mono">ALLOWED_HOSTS</span> do domínio.
        </li>
        <li>
          • Migrações no release; start só sobe o HTTP. Worker Celery é processo extra, não um segundo app.
        </li>
        <li>
          • Opcional: <span className="font-mono text-white">aegis.toml</span> na raiz para fixar runtime, start e
          processos junto com o código.
        </li>
      </ul>
    </Panel>
  </div>
);

const GuideCard: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}> = ({ icon: Icon, title, children }) => (
  <div className="p-4 rounded-lg bg-surface-container-lowest border border-outline-variant space-y-2">
    <div className="flex items-center gap-2 text-primary font-bold text-sm">
      <Icon className="w-4 h-4" />
      <span>{title}</span>
    </div>
    <p className="text-on-surface-variant">{children}</p>
  </div>
);
