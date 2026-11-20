import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Upload, FileText, CheckCircle2, Clock, Camera, AlertCircle, IndianRupee } from 'lucide-react';
import { StorefrontLayout } from '../../components/StorefrontLayout.tsx';
import { Button, Card, Input, Label, Textarea } from '../../components/ui/primitives.tsx';
import { useApp } from '../../context/AppContext.tsx';
import { apiFetch } from '../../lib/api.ts';
import { formatIndianDateTime, formatINRPaise } from '../../shared/types.ts';

interface PrescriptionRecord {
  id: string;
  patient_name: string;
  doctor_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  status: string;
  notes: string | null;
  latest_remarks: string | null;
  quoted_amount_paise: number | null;
  pharmacist_quotation_notes: string | null;
  quotation_accepted: number;
  file_url: string;
  signed_file_url?: string;
  file_mime_type: string;
  created_at: string;
}

export function UploadPrescriptionPage() {
  const { user, showToast } = useApp();
  const [patientName, setPatientName] = useState(user?.fullName || '');
  const [doctorName, setDoctorName] = useState('');
  const [contactPhone, setContactPhone] = useState(user?.phone || '');
  const [contactEmail, setContactEmail] = useState(user?.email || '');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [confirmedRx, setConfirmedRx] = useState<PrescriptionRecord | null>(null);
  const [prescriptions, setPrescriptions] = useState<PrescriptionRecord[]>([]);

  const loadPrescriptions = () => {
    if (!user) return;
    apiFetch<{ prescriptions: PrescriptionRecord[] }>('/api/prescriptions')
      .then((d) => setPrescriptions(d.prescriptions))
      .catch(console.error);
  };

  useEffect(() => {
    if (user) {
      setPatientName((prev) => prev || user.fullName);
      setContactPhone((prev) => prev || user.phone || '');
      setContactEmail((prev) => prev || user.email);
      loadPrescriptions();
    }
  }, [user]);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreviewUrl(null);
  }, [file]);

  const handleFileChange = (selected: File | null) => {
    if (!selected) {
      setFile(null);
      return;
    }
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(selected.type)) {
      showToast('Please select a JPG, PNG, WEBP, or PDF file', 'error');
      return;
    }
    if (selected.size > 8 * 1024 * 1024) {
      showToast('File size must be 8 MB or smaller', 'error');
      return;
    }
    setFile(selected);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      showToast('Please attach a prescription image or PDF', 'error');
      return;
    }
    setSubmitting(true);
    setUploadProgress(5);
    try {
      const formData = new FormData();
      formData.append('patientName', patientName);
      if (doctorName) formData.append('doctorName', doctorName);
      if (contactPhone) formData.append('contactPhone', contactPhone);
      if (contactEmail) formData.append('contactEmail', contactEmail);
      if (notes) formData.append('notes', notes);
      formData.append('file', file);

      const created = await new Promise<{ prescription: PrescriptionRecord }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/prescriptions', true);
        xhr.withCredentials = true;
        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable) {
            setUploadProgress(Math.round((evt.loaded / evt.total) * 95));
          }
        };
        xhr.onload = () => {
          setUploadProgress(100);
          try {
            const parsed = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(parsed);
            } else {
              reject(new Error(parsed.error || 'Upload failed'));
            }
          } catch {
            reject(new Error('Unexpected server response'));
          }
        };
        xhr.onerror = () => reject(new Error('Network error during prescription upload'));
        xhr.send(formData);
      });

      setConfirmedRx(created.prescription);
      showToast('Prescription submitted for pharmacist verification');
      setFile(null);
      setNotes('');
      loadPrescriptions();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Upload failed', 'error');
    } finally {
      setSubmitting(false);
      window.setTimeout(() => setUploadProgress(0), 600);
    }
  };

  const handleAcceptQuotation = async (rxId: string) => {
    try {
      await apiFetch(`/api/prescriptions/${rxId}/accept-quotation`, { method: 'POST' });
      showToast('Pharmacist quotation accepted');
      loadPrescriptions();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Unable to accept quotation', 'error');
    }
  };

  return (
    <StorefrontLayout>
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
        <div className="mb-6 border-b border-[#E1E5EB] pb-4">
          <h1 className="text-2xl font-bold text-[#202630]">Upload Prescription</h1>
          <p className="mt-1 text-xs text-[#526071]">
            Submit a clear photograph or PDF of your doctor&apos;s prescription. A registered pharmacist reviews every prescription before dispensing Schedule H / H1 medicines.
          </p>
        </div>

        <div className="mb-6 flex items-start gap-2.5 rounded-md border border-[#E1E5EB] bg-[#F5F7FA] p-3.5 text-xs text-[#202630]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#D71920]" />
          <div>
            <span className="font-semibold">Dispensing Compliance Notice:</span> Uploading a prescription alone does not authorize purchase or dispatch. Our registered pharmacist verifies patient details, doctor registration, medicine strength, and Schedule H compliance before confirming your order or unlocking online payment.
          </div>
        </div>

        {!user ? (
          <Card className="p-8 text-center space-y-4">
            <h2 className="text-lg font-bold text-[#202630]">Sign in to upload prescriptions</h2>
            <p className="text-sm text-[#526071] max-w-md mx-auto">
              Prescriptions are securely linked to your customer account so our pharmacist can review them, prepare a quotation if requested, and link them to your orders.
            </p>
            <div className="flex justify-center gap-3">
              <Link to="/login?redirect=/upload-prescription">
                <Button>Customer Sign In</Button>
              </Link>
              <Link to="/register?redirect=/upload-prescription">
                <Button variant="outline">Create Account</Button>
              </Link>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
            <div className="lg:col-span-6 space-y-4">
              {confirmedRx && (
                <Card className="border-[#16835D] bg-[#ECFDF5] p-5 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-bold text-[#16835D]">
                    <CheckCircle2 className="h-5 w-5" />
                    <span>Prescription Submitted Successfully</span>
                  </div>
                  <p className="text-xs text-[#202630]">
                    Submission Reference: <span className="font-mono font-bold">{confirmedRx.id.slice(0, 8).toUpperCase()}</span> · Patient: <span className="font-semibold">{confirmedRx.patient_name}</span>
                  </p>
                  <p className="text-xs text-[#526071]">
                    Status: <span className="font-semibold text-[#B45309]">PENDING PHARMACIST REVIEW</span>. You can now attach this submission during checkout or wait for a pharmacist quotation.
                  </p>
                  <div className="flex gap-2 pt-1">
                    <Link to="/checkout">
                      <Button size="sm" variant="secondary">Continue to Checkout</Button>
                    </Link>
                    <Button size="sm" variant="outline" onClick={() => setConfirmedRx(null)}>
                      Upload Another
                    </Button>
                  </div>
                </Card>
              )}

              <Card className="p-6">
                <h2 className="mb-4 text-base font-bold text-[#202630]">New Prescription Submission</h2>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <Label htmlFor="rx-patient">Patient Name *</Label>
                    <Input
                      id="rx-patient"
                      required
                      value={patientName}
                      onChange={(e) => setPatientName(e.target.value)}
                      placeholder="Full name printed on prescription"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="rx-phone">Contact Phone *</Label>
                      <Input
                        id="rx-phone"
                        required
                        value={contactPhone}
                        onChange={(e) => setContactPhone(e.target.value)}
                        placeholder="+91 98XXXXXXXX"
                      />
                    </div>
                    <div>
                      <Label htmlFor="rx-email">Contact Email</Label>
                      <Input
                        id="rx-email"
                        type="email"
                        value={contactEmail}
                        onChange={(e) => setContactEmail(e.target.value)}
                        placeholder="you@example.com"
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="rx-doctor">Prescribing Doctor (Optional)</Label>
                    <Input
                      id="rx-doctor"
                      value={doctorName}
                      onChange={(e) => setDoctorName(e.target.value)}
                      placeholder="e.g., Dr. R. K. Kulkarni"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Prescription File (JPG, PNG, WEBP, or PDF · Max 8 MB) *</Label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <label className="flex items-center justify-center gap-2 rounded-md border border-[#E1E5EB] bg-[#F5F7FA] px-3 py-2.5 text-xs font-semibold text-[#202630] hover:border-[#D71920] cursor-pointer">
                        <Upload className="h-4 w-4 text-[#D71920]" />
                        <span>Choose File from Device</span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,application/pdf"
                          onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
                          className="hidden"
                        />
                      </label>
                      <label className="flex items-center justify-center gap-2 rounded-md border border-[#E1E5EB] bg-[#F5F7FA] px-3 py-2.5 text-xs font-semibold text-[#202630] hover:border-[#16835D] cursor-pointer">
                        <Camera className="h-4 w-4 text-[#16835D]" />
                        <span>Capture with Camera</span>
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
                          className="hidden"
                        />
                      </label>
                    </div>

                    {file && (
                      <div className="rounded-md border border-[#E1E5EB] bg-white p-3 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-[#202630] truncate">{file.name}</span>
                          <span className="text-[#526071] shrink-0">
                            {(file.size / 1024).toFixed(0)} KB
                          </span>
                        </div>
                        {previewUrl ? (
                          <img
                            src={previewUrl}
                            alt="Selected prescription preview"
                            className="max-h-56 w-full rounded border border-[#E1E5EB] object-contain bg-[#F5F7FA]"
                          />
                        ) : (
                          <div className="flex items-center gap-2 rounded bg-[#F5F7FA] p-3 text-xs text-[#526071]">
                            <FileText className="h-5 w-5 text-[#D71920]" />
                            <span>PDF Document selected — ready for pharmacist review</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="rx-notes">Dispensing Notes (Optional)</Label>
                    <Textarea
                      id="rx-notes"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Mention required pack duration or specific instructions for our pharmacist"
                    />
                  </div>

                  {uploadProgress > 0 && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs font-medium text-[#526071]">
                        <span>Uploading prescription securely...</span>
                        <span>{uploadProgress}%</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-[#E1E5EB] overflow-hidden">
                        <div
                          className="h-full bg-[#16835D] transition-all"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <Button type="submit" disabled={submitting} className="w-full" size="lg">
                    <Upload className="h-4 w-4" />
                    {submitting ? 'Uploading...' : 'Submit for Pharmacist Verification'}
                  </Button>
                </form>
              </Card>
            </div>

            <div className="lg:col-span-6 space-y-4">
              <h2 className="text-base font-bold text-[#202630]">Your Uploaded Prescriptions</h2>
              {prescriptions.length === 0 ? (
                <Card className="p-6 text-sm text-[#526071]">
                  No prescriptions uploaded yet. Submitted prescriptions appear here with live pharmacist verification status and quotation approval.
                </Card>
              ) : (
                prescriptions.map((rx) => (
                  <Card key={rx.id} className="p-4 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold text-[#202630]">{rx.patient_name}</div>
                        <div className="text-xs text-[#526071]">
                          {rx.doctor_name || 'Doctor not specified'} · {formatIndianDateTime(rx.created_at)}
                        </div>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold ${
                          rx.status === 'APPROVED'
                            ? 'bg-[#ECFDF5] text-[#16835D]'
                            : rx.status === 'REJECTED'
                              ? 'bg-[#FFF5F5] text-[#B5121B]'
                              : 'bg-[#FEF3C7] text-[#B45309]'
                        }`}
                      >
                        {rx.status === 'APPROVED' ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : (
                          <Clock className="h-3.5 w-3.5" />
                        )}
                        {rx.status.replace(/_/g, ' ')}
                      </span>
                    </div>

                    {rx.latest_remarks && (
                      <p className="rounded bg-[#F5F7FA] px-3 py-2 text-xs text-[#202630]">
                        Pharmacist remark: {rx.latest_remarks}
                      </p>
                    )}

                    {rx.quoted_amount_paise !== null && rx.quoted_amount_paise > 0 && (
                      <div className="rounded-md border border-[#A7F3D0] bg-[#ECFDF5] p-3 text-xs space-y-1.5">
                        <div className="flex items-center justify-between font-semibold text-[#16835D]">
                          <span className="inline-flex items-center gap-1">
                            <IndianRupee className="h-3.5 w-3.5" />
                            Pharmacist Prepared Quotation
                          </span>
                          <span className="text-sm font-bold tabular-nums">
                            {formatINRPaise(rx.quoted_amount_paise)}
                          </span>
                        </div>
                        {rx.pharmacist_quotation_notes && (
                          <p className="text-[#202630]">{rx.pharmacist_quotation_notes}</p>
                        )}
                        {rx.quotation_accepted ? (
                          <div className="font-semibold text-[#16835D]">
                            ✓ Quotation Accepted
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleAcceptQuotation(rx.id)}
                          >
                            Accept Quotation
                          </Button>
                        )}
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-1 text-xs">
                      <a
                        href={rx.signed_file_url || rx.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-[#D71920] hover:underline"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        View Uploaded File
                      </a>
                      {rx.status === 'APPROVED' && (
                        <Link to="/checkout" className="font-medium text-[#16835D] hover:underline">
                          Use at Checkout →
                        </Link>
                      )}
                    </div>
                  </Card>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </StorefrontLayout>
  );
}
