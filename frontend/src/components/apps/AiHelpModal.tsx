import React, { useState } from 'react';
import { Check, Copy, ShieldCheck, Sparkles, X } from 'lucide-react';

export const AEGIS_AI_PROMPT = `Estou hospedando meu projeto no painel AegisPanel (uma plataforma Cloud PaaS que roda em VPS Linux com Docker e Caddy).
A maioria dos meus projetos foi inicialmente desenvolvida para a Vercel, mas agora preciso que você adapte e prepare todo o código para rodar no AegisPanel sem nenhum erro de build ou deploy:

1. SCRIPTS NO PACKAGE.JSON:
   - Certifique-se de que os scripts "build" e "start" existem e funcionam corretamente.
   - O script "start" deve iniciar o servidor de produção (ex: "next start", "node dist/index.js", etc.).
   - Se for uma SPA (Vite/React), certifique-se de que "build" gera a pasta "dist".

2. HOST E PORTA (BINDING):
   - O servidor DEVE escutar no host '0.0.0.0' (e NÃO apenas em 'localhost').
   - Use a porta fornecida pela variável de ambiente: process.env.PORT || 3000.

3. DEPENDÊNCIAS:
   - Mova ferramentas de build essenciais para "dependencies" ou garanta que rodem no build.
   - Substitua quaisquer dependências exclusivas da Vercel Edge por equivalentes universais Node.js.

Revise meus arquivos de configuração e me entregue o código pronto para deploy!`;

interface AiHelpModalProps {
  onClose: () => void;
}

export const AiHelpModal: React.FC<AiHelpModalProps> = ({ onClose }) => {
  const [copiedAiPrompt, setCopiedAiPrompt] = useState(false);

  const copyPrompt = () => {
    void navigator.clipboard.writeText(AEGIS_AI_PROMPT);
    setCopiedAiPrompt(true);
    setTimeout(() => setCopiedAiPrompt(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface-container rounded-lg border border-purple-500/40 w-full max-w-2xl overflow-hidden p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded bg-purple-500/20 text-purple-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">Prompt Mágico para IAs (Vercel ➔ AegisPanel)</h3>
              <p className="text-xs text-on-surface-variant">
                Envie este prompt para sua IA (ChatGPT, Claude, Cursor, v0) preparar seu código.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-on-surface-variant hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <textarea
          readOnly
          rows={10}
          className="w-full bg-surface-container-lowest/90 border border-outline-variant rounded-lg p-4 text-xs font-mono text-on-surface focus:outline-none select-all custom-scrollbar leading-relaxed"
          value={AEGIS_AI_PROMPT}
        />

        <div className="flex items-center justify-between pt-1">
          <span className="text-[11px] text-on-surface-variant flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-primary" />
            <span>Compatível com ChatGPT, Claude 3.5, Cursor e v0.</span>
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-on-surface-variant hover:text-white text-xs font-semibold"
            >
              Fechar
            </button>
            <button
              onClick={copyPrompt}
              className="flex items-center gap-1.5 px-5 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded text-xs font-semibold transition-all active:scale-95"
            >
              {copiedAiPrompt ? <Check className="w-4 h-4 text-ok" /> : <Copy className="w-4 h-4" />}
              <span>{copiedAiPrompt ? 'Copiado com Sucesso!' : 'Copiar Prompt para Minha IA'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
