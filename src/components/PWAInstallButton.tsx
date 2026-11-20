import React, { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall.ts';
import { Button } from './ui/primitives.tsx';

export function PWAInstallButton() {
  const { canInstallNatively, isIOS, isInstalled, install } = usePWAInstall();
  const [showIosGuide, setShowIosGuide] = useState(false);

  if (isInstalled) return null;
  if (!canInstallNatively && !isIOS) return null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-9 min-h-[36px] text-xs border-[#16835D] text-[#16835D] hover:bg-[#F0FDF4]"
        onClick={() => {
          if (canInstallNatively) {
            void install();
          } else {
            setShowIosGuide(true);
          }
        }}
      >
        {isIOS && !canInstallNatively ? (
          <Share className="h-3.5 w-3.5" />
        ) : (
          <Download className="h-3.5 w-3.5" />
        )}
        <span className="hidden sm:inline">Install App</span>
      </Button>

      {showIosGuide && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-lg border border-[#E1E5EB] bg-white p-5 space-y-3 shadow-lg">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#202630]">Install Rider App on iOS</h3>
              <button
                type="button"
                onClick={() => setShowIosGuide(false)}
                className="p-1 text-[#526071] hover:text-[#202630]"
                aria-label="Close install instructions"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <ol className="list-decimal pl-5 space-y-1.5 text-xs text-[#526071]">
              <li>
                Tap the <strong className="text-[#202630]">Share</strong> button in Safari&apos;s toolbar.
              </li>
              <li>
                Scroll down and select <strong className="text-[#202630]">Add to Home Screen</strong>.
              </li>
              <li>
                Tap <strong className="text-[#202630]">Add</strong> to launch SLM Rider full-screen.
              </li>
            </ol>
            <Button className="w-full" size="sm" onClick={() => setShowIosGuide(false)}>
              Got It
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
