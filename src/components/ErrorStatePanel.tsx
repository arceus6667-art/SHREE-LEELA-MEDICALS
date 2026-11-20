import React from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CreditCard,
  FileWarning,
  Lock,
  MapPinOff,
  PackageX,
  RefreshCw,
  ServerCrash,
  WifiOff,
} from 'lucide-react';
import { Button, Card } from './ui/primitives.tsx';
import type { AppErrorCode } from '../shared/types.ts';

interface ErrorCopy {
  title: string;
  guidance: string;
  actionLabel?: string;
  actionHref?: string;
  icon: React.ComponentType<{ className?: string }>;
}

const ERROR_COPY_MAP: Record<string, ErrorCopy> = {
  PRODUCT_UNAVAILABLE: {
    title: 'Medicine Currently Unavailable',
    guidance: 'This medicine is out of stock, expired, or restricted for online doorstep purchase. Browse alternatives or ask our pharmacist.',
    actionLabel: 'Browse Catalog',
    actionHref: '/pharmacy',
    icon: PackageX,
  },
  STOCK_CHANGED: {
    title: 'Inventory Availability Changed',
    guidance: 'Another customer completed an order for the remaining stock of an item in your cart. Please review quantities and retry.',
    actionLabel: 'Review Cart',
    actionHref: '/cart',
    icon: AlertTriangle,
  },
  INVALID_ADDRESS: {
    title: 'Invalid or Incomplete Address',
    guidance: 'Please provide a complete building/flat number, street, and valid 6-digit PIN code so our delivery partner can locate you.',
    icon: MapPinOff,
  },
  AREA_UNSERVICEABLE: {
    title: 'Area Outside Home Delivery Zone',
    guidance: 'Home delivery is unavailable for this PIN code. You can switch to Free Store Pickup at Gaurav Avenue, Mira Road East.',
    icon: MapPinOff,
  },
  RX_REJECTED: {
    title: 'Prescription Requires Attention',
    guidance: 'Our registered pharmacist flagged or rejected the attached prescription. Upload a clear, valid prescription to proceed.',
    actionLabel: 'Upload Prescription',
    actionHref: '/upload-prescription',
    icon: FileWarning,
  },
  PAYMENT_FAILED: {
    title: 'Payment Authorization Failed',
    guidance: 'Your payment could not be verified or was declined. No amount has been charged; you can retry online payment or choose Cash on Delivery.',
    icon: CreditCard,
  },
  SERVER_UNAVAILABLE: {
    title: 'Connection Interrupted',
    guidance: 'The pharmacy server could not be reached within the timeout window. Please check your internet connection and retry.',
    icon: ServerCrash,
  },
  GPS_DISCONNECTED: {
    title: 'GPS Signal Temporarily Unavailable',
    guidance: 'Location telemetry is paused or offline. Live tracking continues updating automatically using HTTP fallback.',
    icon: WifiOff,
  },
  SESSION_EXPIRED: {
    title: 'Session Expired',
    guidance: 'For your security, please sign in again to continue managing orders and prescriptions.',
    actionLabel: 'Sign In',
    actionHref: '/login',
    icon: Lock,
  },
  UNAUTHORIZED: {
    title: 'Access Restricted',
    guidance: 'Your account role does not have permission to access this medical or operational resource.',
    actionLabel: 'Go Home',
    actionHref: '/',
    icon: Lock,
  },
};

export function ErrorStatePanel({
  code,
  message,
  onRetry,
  secondaryAction,
}: {
  code?: AppErrorCode | string;
  message?: string;
  onRetry?: () => void;
  secondaryAction?: React.ReactNode;
}) {
  const cfg = (code && ERROR_COPY_MAP[code]) || {
    title: 'Action Could Not Be Completed',
    guidance: 'Please review the details below and try again.',
    icon: AlertTriangle,
  };
  const Icon = cfg.icon;

  return (
    <Card className="p-5 border-[#F5C2C7] bg-[#FFF5F5]">
      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
        <Icon className="h-5 w-5 text-[#B5121B] shrink-0 mt-0.5" />
        <div className="flex-1 space-y-1.5">
          <div className="text-sm font-bold text-[#B5121B]">{cfg.title}</div>
          {message && <p className="text-xs font-semibold text-[#202630]">{message}</p>}
          <p className="text-xs text-[#526071]">{cfg.guidance}</p>
          <div className="flex flex-wrap gap-2 pt-2">
            {onRetry && (
              <Button size="sm" variant="outline" onClick={onRetry}>
                <RefreshCw className="h-3.5 w-3.5" />
                Retry
              </Button>
            )}
            {cfg.actionHref && cfg.actionLabel && (
              <Link to={cfg.actionHref}>
                <Button size="sm" variant="secondary">
                  {cfg.actionLabel}
                </Button>
              </Link>
            )}
            {secondaryAction}
          </div>
        </div>
      </div>
    </Card>
  );
}
