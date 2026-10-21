import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        output: {
          // Keep big libraries in their own files so browsers can cache them between updates.
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined;
            if (/[\\/]node_modules[\\/](firebase|@firebase)[\\/]/.test(id)) return 'firebase';
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
            // The PDF makers load only when someone makes a quotation PDF (src/lib/quotePdf.ts), not at login.
            // The T3 form maker's readers and PDF filler load only when it's used (src/lib/t3Names.ts, t3Pdf.ts).
            if (/[\\/]node_modules[\\/](exceljs|mammoth|pdf-lib|@pdf-lib|pdfjs-dist)[\\/]/.test(id)) return undefined;
            if (/[\\/]node_modules[\\/](jspdf|html2canvas|html2canvas-pro|canvg|fflate|fast-png|iobuffer|pako|dompurify|core-js|@babel[\\/]runtime|regenerator-runtime|raf|performance-now|rgbcolor|stackblur-canvas|svg-pathdata|css-line-break|text-segmentation|utrie|base64-arraybuffer)[\\/]/.test(id)) return undefined;
            return 'vendor';
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
