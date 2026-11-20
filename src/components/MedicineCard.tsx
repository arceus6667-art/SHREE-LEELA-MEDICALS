import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Minus, Pill, ShieldAlert, BellRing } from 'lucide-react';
import { Button, Input, Label } from './ui/primitives.tsx';
import { useApp } from '../context/AppContext.tsx';
import { apiFetch } from '../lib/api.ts';
import { formatINRPaise, type MedicineDTO } from '../shared/types.ts';

export function MedicineCard({
  medicine,
  highlightQuery = '',
}: {
  medicine: MedicineDTO;
  highlightQuery?: string;
}) {
  const { cart, user, addToCart, updateCartQty, showToast } = useApp();
  const [imgError, setImgError] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [reqName, setReqName] = useState(user?.fullName || '');
  const [reqPhone, setReqPhone] = useState(user?.phone || '');
  const [submittingReq, setSubmittingReq] = useState(false);

  const cartItem = cart?.items.find((i) => i.medicineId === medicine.id);
  const discountPct =
    medicine.mrpPaise > medicine.salePricePaise
      ? Math.round(((medicine.mrpPaise - medicine.salePricePaise) / medicine.mrpPaise) * 100)
      : 0;

  const renderHighlighted = (text: string) => {
    const q = highlightQuery.trim();
    if (!q || q.length < 2) return text;
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
    return parts.map((part, idx) =>
      part.toLowerCase() === q.toLowerCase() ? (
        <mark key={idx} className="bg-[#FEF3C7] text-[#202630] px-0.5 rounded-sm">
          {part}
        </mark>
      ) : (
        <React.Fragment key={idx}>{part}</React.Fragment>
      )
    );
  };

  const handleRequestAvailability = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingReq(true);
    try {
      await apiFetch('/api/catalog/request-availability', {
        method: 'POST',
        body: JSON.stringify({
          medicineId: medicine.id,
          medicineName: medicine.name,
          requesterName: reqName,
          requesterPhone: reqPhone,
        }),
      });
      showToast('Availability request sent to Shree Leela Pharmacy');
      setRequestOpen(false);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Unable to send request', 'error');
    } finally {
      setSubmittingReq(false);
    }
  };

  return (
    <div className="group flex flex-col justify-between rounded-lg border border-[#E1E5EB] bg-white p-3.5 sm:p-4 transition-all duration-150 hover:border-[#C7CFD9]">
      <div>
        <Link
          to={`/medicine/${medicine.slug}`}
          className="relative mb-3 block aspect-[4/3] w-full overflow-hidden rounded-md bg-[#F5F7FA]"
        >
          {!imgError && medicine.imageUrl ? (
            <img
              src={medicine.imageUrl}
              alt={medicine.name}
              referrerPolicy="no-referrer"
              onError={() => setImgError(true)}
              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-[#6B7686]">
              <Pill className="h-7 w-7 text-[#D71920]" />
              <span className="text-xs font-medium">{medicine.dosageForm}</span>
            </div>
          )}
        </Link>

        <div className="mb-1 flex items-center gap-1.5 text-[11px] text-[#526071] truncate">
          <span className="truncate">{medicine.manufacturerName}</span>
        </div>

        <Link
          to={`/medicine/${medicine.slug}`}
          className="mb-1 block text-sm font-semibold leading-snug text-[#202630] hover:text-[#D71920] line-clamp-2"
        >
          {renderHighlighted(medicine.name)}
        </Link>

        <p className="mb-1.5 text-xs text-[#526071] line-clamp-1">
          {renderHighlighted(medicine.genericName)}
        </p>

        <div className="mb-2 text-[11px] text-[#526071]">
          {medicine.strength ? `${medicine.strength} · ` : ''}
          {medicine.packSize}
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
          {medicine.requiresPrescription ? (
            <span className="inline-flex items-center gap-1 font-medium text-[#B5121B]">
              <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
              Rx Required ({medicine.scheduleType})
            </span>
          ) : (
            <span className="font-medium text-[#16835D]">OTC</span>
          )}
          <span aria-hidden="true" className="text-[#CBD2D9]">·</span>
          <span className={`font-medium tabular-nums ${medicine.canPurchase ? 'text-[#16835D]' : 'text-[#B5121B]'}`}>
            {medicine.canPurchase
              ? `${medicine.availableStock} in stock`
              : medicine.isRecalled
                ? 'Recalled'
                : medicine.onlineSaleRestricted
                  ? 'Store Only'
                  : 'Out of Stock'}
          </span>
        </div>
      </div>

      <div className="border-t border-[#E1E5EB] pt-3">
        <div className="mb-2.5 flex items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-2 tabular-nums">
            <span className="text-base font-bold text-[#202630]">
              {formatINRPaise(medicine.salePricePaise)}
            </span>
            {discountPct > 0 && (
              <span className="text-xs text-[#6B7686] line-through">
                {formatINRPaise(medicine.mrpPaise)}
              </span>
            )}
          </div>
          {discountPct > 0 && (
            <span className="text-xs font-semibold text-[#16835D] tabular-nums">
              {discountPct}% off
            </span>
          )}
        </div>

        {!medicine.canPurchase ? (
          <div className="space-y-2">
            <Button variant="outline" size="sm" className="w-full" disabled>
              {medicine.isRecalled
                ? 'Recalled'
                : medicine.onlineSaleRestricted
                  ? 'Online Sale Restricted'
                  : 'Unavailable'}
            </Button>
            {!medicine.isRecalled && !medicine.onlineSaleRestricted && (
              <button
                type="button"
                onClick={() => setRequestOpen((v) => !v)}
                className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-medium text-[#D71920] hover:underline cursor-pointer"
              >
                <BellRing className="h-3.5 w-3.5" />
                Request Availability
              </button>
            )}
            {requestOpen && (
              <form onSubmit={handleRequestAvailability} className="mt-2 space-y-2 rounded border border-[#E1E5EB] bg-[#F5F7FA] p-2.5">
                <div>
                  <Label className="text-[11px]">Your Name</Label>
                  <Input required value={reqName} onChange={(e) => setReqName(e.target.value)} className="h-8 text-xs" />
                </div>
                <div>
                  <Label className="text-[11px]">Phone Number</Label>
                  <Input required value={reqPhone} onChange={(e) => setReqPhone(e.target.value)} className="h-8 text-xs" />
                </div>
                <Button type="submit" size="sm" className="w-full" disabled={submittingReq}>
                  {submittingReq ? 'Sending...' : 'Notify Store Desk'}
                </Button>
              </form>
            )}
          </div>
        ) : cartItem ? (
          <div className="flex items-center justify-between rounded-md border border-[#D71920] bg-[#FFF5F5]">
            <button
              type="button"
              aria-label="Decrease quantity"
              onClick={() => updateCartQty(medicine.id, cartItem.quantity - 1)}
              className="flex h-9 w-10 items-center justify-center text-[#D71920] hover:bg-[#FEE2E2] cursor-pointer"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold text-[#202630] tabular-nums">
              {cartItem.quantity} in Cart
            </span>
            <button
              type="button"
              aria-label="Increase quantity"
              onClick={() => updateCartQty(medicine.id, cartItem.quantity + 1)}
              className="flex h-9 w-10 items-center justify-center text-[#D71920] hover:bg-[#FEE2E2] cursor-pointer"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <Button
            variant="default"
            size="sm"
            className="w-full"
            onClick={() => addToCart(medicine.id, 1)}
          >
            Add to Cart
          </Button>
        )}
      </div>
    </div>
  );
}
