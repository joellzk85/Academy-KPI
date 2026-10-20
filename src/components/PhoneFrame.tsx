import React, { useState } from 'react';
import { createPortal } from 'react-dom';

// The phone preview: a real phone-width page (an inner frame with the CRM's styles), so the website uses its
// phone layout, exactly as on the client's phone.
export default function PhoneFrame({ children }: { children: React.ReactNode }) {
  const [body, setBody] = useState<HTMLElement | null>(null);
  const ref = (el: HTMLIFrameElement | null) => {
    if (!el || body) return;
    const setup = () => {
      const d = el.contentDocument;
      if (!d || d.body.dataset.ready) return;
      d.head.innerHTML = '<meta name="viewport" content="width=device-width, initial-scale=1">';
      document.querySelectorAll('style, link[rel="stylesheet"]').forEach(n => d.head.appendChild(n.cloneNode(true)));
      d.body.style.margin = '0';
      d.body.dataset.ready = '1';
      setBody(d.body);
    };
    if (el.contentDocument?.readyState === 'complete') setup(); else el.addEventListener('load', setup, { once: true });
  };
  return (
    <>
      <iframe ref={ref} title="Phone preview" className="h-full w-full border-0" />
      {body && createPortal(children, body)}
    </>
  );
}
