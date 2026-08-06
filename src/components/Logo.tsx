import React, { useState } from 'react';

interface LogoProps {
  className?: string;
}

export default function Logo({ className }: LogoProps) {
  const [hasError, setHasError] = useState(false);

  const finalClass = className || "h-[60px] w-auto object-contain";
  const svgClass = className || "h-[60px] w-auto";

  if (hasError) {
    return (
      <div className="flex items-center gap-2" id="next-logo">
        <svg className={svgClass} viewBox="0 0 200 65" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* "ne" in dark slate */}
          <text x="5" y="32" fill="#1e293b" fontSize="26" fontWeight="900" fontFamily="Inter, sans-serif">ne</text>
          
          {/* Stylized Green Arrow "xt" */}
          {/* First Arrow chevron */}
          <path d="M38 14 L46 23 L38 32" stroke="#10B981" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          {/* Second Arrow chevron */}
          <path d="M48 14 L56 23 L48 32" stroke="#10B981" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          
          {/* "t" in dark slate */}
          <text x="61" y="32" fill="#1e293b" fontSize="26" fontWeight="900" fontFamily="Inter, sans-serif">t</text>
          
          {/* "academy" below */}
          <text x="5" y="52" fill="#64748b" fontSize="13" letterSpacing="0.16em" fontWeight="700" fontFamily="Inter, sans-serif">academy</text>
        </svg>
      </div>
    );
  }

  return (
    <div className="flex items-center" id="next-logo">
      <img 
        src="https://lh3.googleusercontent.com/d/1UnRt0nGMgesGmlh69s6RkTmhEZ1eZ_4B" 
        alt="NEXT Academy Logo" 
        className={finalClass}
        referrerPolicy="no-referrer"
        onError={() => setHasError(true)}
      />
    </div>
  );
}
