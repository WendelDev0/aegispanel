import React from 'react';

export interface ProviderLogoProps {
  id: string;
  name?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  iconUrl?: string;
}

export const ProviderLogo: React.FC<ProviderLogoProps> = ({
  id,
  name = '',
  className = '',
  size = 'md',
  iconUrl,
}) => {
  const [imgError, setImgError] = React.useState(false);

  const sizeClasses = {
    sm: 'w-7 h-7 p-1 text-xs',
    md: 'w-10 h-10 p-1.5 text-sm',
    lg: 'w-12 h-12 p-2 text-base',
    xl: 'w-16 h-16 p-2.5 text-lg',
  }[size];

  const normalizedId = id.toLowerCase().replace(/[^a-z0-9-]/g, '');

  // Render official vector logos for known providers
  const renderSvgLogo = () => {
    switch (true) {
      case normalizedId.includes('evolution') || normalizedId.includes('whatsapp'):
        return (
          <div className="w-full h-full flex items-center justify-center relative">
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full drop-shadow-[0_2px_8px_rgba(37,211,102,0.4)]">
              <rect width="24" height="24" rx="5" fill="#25D366" />
              <path
                d="M17.5 14.3c-.3-.1-1.8-.9-2.1-1-.3-.1-.5-.1-.7.2-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.2-1.3-.5-2.5-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5-.1-.1-.7-1.7-.9-2.3-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.4-1.2 1.1-1.2 2.8s1.2 3.2 1.4 3.4c.2.2 2.4 3.7 5.8 5.1 2.8 1.2 3.4 1 4 .9.7-.1 1.8-.7 2.1-1.5.2-.7.2-1.4.2-1.5-.1-.2-.3-.3-.6-.4z"
                fill="#ffffff"
              />
              <path
                d="M12 4.5a7.5 7.5 0 00-6.5 11.2L4.5 19.5l4-1a7.5 7.5 0 103.5-14zm0 13.5c-1.2 0-2.3-.3-3.3-.9l-.2-.1-2.4.6.6-2.3-.2-.3a6 6 0 115.3 3z"
                fill="#ffffff"
              />
            </svg>
          </div>
        );

      case normalizedId.includes('n8n'):
        return (
          <div className="w-full h-full flex items-center justify-center">
            <svg viewBox="0 0 120 40" fill="none" className="w-full h-full">
              <rect width="120" height="40" rx="8" fill="#FF6D5A" />
              <circle cx="28" cy="20" r="7" fill="#ffffff" />
              <circle cx="60" cy="14" r="6" fill="#ffffff" />
              <circle cx="60" cy="26" r="6" fill="#ffffff" />
              <circle cx="92" cy="20" r="7" fill="#ffffff" />
              <path d="M28 20 L60 14" stroke="#ffffff" strokeWidth="3" />
              <path d="M28 20 L60 26" stroke="#ffffff" strokeWidth="3" />
              <path d="M60 14 L92 20" stroke="#ffffff" strokeWidth="3" />
              <path d="M60 26 L92 20" stroke="#ffffff" strokeWidth="3" />
            </svg>
          </div>
        );

      case normalizedId.includes('chatwoot'):
        return (
          <div className="w-full h-full flex items-center justify-center">
            <svg viewBox="0 0 48 48" fill="none" className="w-full h-full">
              <rect width="48" height="48" rx="10" fill="#1F93FF" />
              <path
                d="M12 16C12 13.7909 13.7909 12 16 12H32C34.2091 12 36 13.7909 36 16V28C36 30.2091 34.2091 32 32 32H20L13 37V16Z"
                fill="#ffffff"
              />
              <path
                d="M20 22C20 20.8954 20.8954 20 22 20C23.1046 20 24 20.8954 24 22C24 23.1046 23.1046 24 22 24C20.8954 24 20 23.1046 20 22Z"
                fill="#1F93FF"
              />
              <path
                d="M26 22C26 20.8954 26.8954 20 28 20C29.1046 20 30 20.8954 30 22C30 23.1046 29.1046 24 28 24C26.8954 24 26 23.1046 26 22Z"
                fill="#1F93FF"
              />
            </svg>
          </div>
        );

      case normalizedId.includes('typebot'):
        return (
          <div className="w-full h-full flex items-center justify-center">
            <svg viewBox="0 0 48 48" fill="none" className="w-full h-full">
              <rect width="48" height="48" rx="10" fill="#0042DA" />
              <rect x="14" y="14" width="20" height="16" rx="4" fill="#ffffff" />
              <circle cx="20" cy="21" r="2.5" fill="#0042DA" />
              <circle cx="28" cy="21" r="2.5" fill="#0042DA" />
              <path d="M24 10V14" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" />
              <circle cx="24" cy="9" r="1.5" fill="#ffffff" />
              <path d="M19 33L24 38L29 33" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        );

      case normalizedId.includes('flowise'):
        return (
          <div className="w-full h-full flex items-center justify-center">
            <svg viewBox="0 0 48 48" fill="none" className="w-full h-full">
              <rect width="48" height="48" rx="10" fill="#4338CA" />
              <circle cx="16" cy="18" r="4" fill="#A5B4FC" />
              <circle cx="32" cy="18" r="4" fill="#A5B4FC" />
              <circle cx="24" cy="32" r="5" fill="#6EE7B7" />
              <path d="M16 18L24 32" stroke="#ffffff" strokeWidth="2.5" strokeDasharray="2 2" />
              <path d="M32 18L24 32" stroke="#ffffff" strokeWidth="2.5" strokeDasharray="2 2" />
              <path d="M16 18L32 18" stroke="#ffffff" strokeWidth="2" />
            </svg>
          </div>
        );

      case normalizedId.includes('uptime') || normalizedId.includes('kuma'):
        return (
          <div className="w-full h-full flex items-center justify-center">
            <svg viewBox="0 0 48 48" fill="none" className="w-full h-full">
              <rect width="48" height="48" rx="10" fill="#10B981" />
              <circle cx="24" cy="24" r="13" fill="#ffffff" />
              <circle cx="16" cy="14" r="4" fill="#ffffff" />
              <circle cx="32" cy="14" r="4" fill="#ffffff" />
              <circle cx="20" cy="22" r="2" fill="#10B981" />
              <circle cx="28" cy="22" r="2" fill="#10B981" />
              <ellipse cx="24" cy="27" rx="3" ry="2" fill="#10B981" />
            </svg>
          </div>
        );

      case normalizedId.includes('wordpress'):
        return (
          <div className="w-full h-full flex items-center justify-center">
            <svg viewBox="0 0 48 48" fill="none" className="w-full h-full">
              <rect width="48" height="48" rx="10" fill="#21759B" />
              <circle cx="24" cy="24" r="14" stroke="#ffffff" strokeWidth="2" fill="none" />
              <path
                d="M15 24C15 27.5 17 30.5 20 32L15 18C15 20 15 22 15 24ZM27 31.8L31.5 19C31.5 19 32 17.5 30.5 17.5L27 31.8ZM23.2 24.2L20.5 16.5C21.6 16.2 22.8 16 24 16C25.2 16 26.4 16.2 27.5 16.5L23.2 24.2Z"
                fill="#ffffff"
              />
            </svg>
          </div>
        );

      case normalizedId.includes('minio'):
        return (
          <div className="w-full h-full flex items-center justify-center">
            <svg viewBox="0 0 48 48" fill="none" className="w-full h-full">
              <rect width="48" height="48" rx="10" fill="#C72C48" />
              <path
                d="M12 28L24 14L36 28L30 34L24 27L18 34L12 28Z"
                fill="#ffffff"
              />
              <circle cx="24" cy="21" r="2" fill="#C72C48" />
            </svg>
          </div>
        );

      case normalizedId.includes('pocketbase'):
        return (
          <div className="w-full h-full flex items-center justify-center">
            <svg viewBox="0 0 48 48" fill="none" className="w-full h-full">
              <rect width="48" height="48" rx="10" fill="#1E293B" />
              <path
                d="M14 16C14 13.8 15.8 12 18 12H30C32.2 12 34 13.8 34 16V22C34 27.5 29.5 32 24 32C18.5 32 14 27.5 14 22V16Z"
                fill="#00DDB3"
              />
              <circle cx="20" cy="18" r="2" fill="#1E293B" />
              <circle cx="28" cy="18" r="2" fill="#1E293B" />
              <path d="M21 24C22 25 26 25 27 24" stroke="#1E293B" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
        );

      case normalizedId.includes('postgres'):
        return (
          <div className="w-full h-full flex items-center justify-center">
            <svg viewBox="0 0 48 48" fill="none" className="w-full h-full">
              <rect width="48" height="48" rx="10" fill="#336791" />
              <ellipse cx="24" cy="25" rx="12" ry="10" fill="#ffffff" />
              <circle cx="20" cy="22" r="2" fill="#336791" />
              <path d="M16 28C18 32 21 34 24 34C27 34 30 32 32 28" stroke="#336791" strokeWidth="2" fill="none" />
              <path d="M24 15V22" stroke="#336791" strokeWidth="2.5" />
            </svg>
          </div>
        );

      case normalizedId.includes('redis'):
        return (
          <div className="w-full h-full flex items-center justify-center">
            <svg viewBox="0 0 48 48" fill="none" className="w-full h-full">
              <rect width="48" height="48" rx="10" fill="#DC382D" />
              <path d="M24 13L35 19L24 25L13 19L24 13Z" fill="#ffffff" />
              <path d="M13 22L24 28L35 22L35 27L24 33L13 27V22Z" fill="#ffffff" fillOpacity="0.85" />
              <path d="M13 29L24 35L35 29L35 32L24 38L13 32V29Z" fill="#ffffff" fillOpacity="0.65" />
            </svg>
          </div>
        );

      case normalizedId.includes('mysql'):
        return (
          <div className="w-full h-full flex items-center justify-center">
            <svg viewBox="0 0 48 48" fill="none" className="w-full h-full">
              <rect width="48" height="48" rx="10" fill="#00758F" />
              <path
                d="M14 26C16 18 24 16 30 18C33 19 35 21 35 24C35 28 30 30 26 31C22 32 17 31 14 26Z"
                fill="#F29111"
              />
              <circle cx="28" cy="21" r="1.5" fill="#ffffff" />
            </svg>
          </div>
        );

      case normalizedId.includes('ollama'):
        return (
          <div className="w-full h-full flex items-center justify-center">
            <svg viewBox="0 0 48 48" fill="none" className="w-full h-full">
              <rect width="48" height="48" rx="10" fill="#0F172A" />
              <circle cx="24" cy="24" r="13" fill="#ffffff" />
              <ellipse cx="24" cy="25" rx="8" ry="7" fill="#0F172A" />
              <circle cx="21" cy="23" r="1.5" fill="#ffffff" />
              <circle cx="27" cy="23" r="1.5" fill="#ffffff" />
              <path d="M18 15L20 20" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
              <path d="M30 15L28 20" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </div>
        );

      case normalizedId.includes('portainer'):
        return (
          <div className="w-full h-full flex items-center justify-center">
            <svg viewBox="0 0 48 48" fill="none" className="w-full h-full">
              <rect width="48" height="48" rx="10" fill="#13BEBB" />
              <rect x="15" y="16" width="8" height="6" rx="1.5" fill="#ffffff" />
              <rect x="25" y="16" width="8" height="6" rx="1.5" fill="#ffffff" />
              <rect x="15" y="24" width="8" height="6" rx="1.5" fill="#ffffff" />
              <rect x="25" y="24" width="8" height="6" rx="1.5" fill="#ffffff" />
              <rect x="20" y="32" width="8" height="4" rx="1" fill="#ffffff" opacity="0.8" />
            </svg>
          </div>
        );

      case normalizedId.includes('strapi'):
        return (
          <div className="w-full h-full flex items-center justify-center">
            <svg viewBox="0 0 48 48" fill="none" className="w-full h-full">
              <rect width="48" height="48" rx="10" fill="#4945FF" />
              <rect x="15" y="15" width="8" height="8" rx="2" fill="#ffffff" />
              <rect x="25" y="15" width="8" height="8" rx="2" fill="#9592FF" />
              <rect x="15" y="25" width="8" height="8" rx="2" fill="#9592FF" />
              <rect x="25" y="25" width="8" height="8" rx="2" fill="#ffffff" />
            </svg>
          </div>
        );

      case normalizedId.includes('grafana'):
        return (
          <div className="w-full h-full flex items-center justify-center">
            <svg viewBox="0 0 48 48" fill="none" className="w-full h-full">
              <rect width="48" height="48" rx="10" fill="#F46800" />
              <circle cx="24" cy="24" r="11" stroke="#ffffff" strokeWidth="3" fill="none" />
              <circle cx="24" cy="24" r="5" fill="#ffffff" />
              <line x1="24" y1="13" x2="24" y2="18" stroke="#ffffff" strokeWidth="2.5" />
              <line x1="24" y1="30" x2="24" y2="35" stroke="#ffffff" strokeWidth="2.5" />
            </svg>
          </div>
        );

      default:
        return null;
    }
  };

  const svgElement = renderSvgLogo();

  if (svgElement) {
    return (
      <div className={`rounded-xl flex items-center justify-center overflow-hidden shrink-0 ${sizeClasses} ${className}`}>
        {svgElement}
      </div>
    );
  }

  // Fallback to image if specified and not errored
  if (iconUrl && !imgError) {
    return (
      <div className={`rounded-xl bg-surface-container-low border border-outline-variant flex items-center justify-center overflow-hidden shrink-0 ${sizeClasses} ${className}`}>
        <img
          src={iconUrl}
          alt={name || id}
          className="w-full h-full object-contain"
          onError={() => setImgError(true)}
        />
      </div>
    );
  }

  // Generic fallback
  const firstLetter = (name || id).charAt(0).toUpperCase() || 'A';
  return (
    <div
      className={`rounded-xl bg-gradient-to-br from-primary/30 to-indigo-600/30 border border-primary/30 flex items-center justify-center font-bold font-mono text-primary select-none shrink-0 ${sizeClasses} ${className}`}
    >
      {firstLetter}
    </div>
  );
};
