import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { transferSchema, type TransferStockInput } from '@ims/shared';
import { Card, PageHeader } from '../../../components/Card';
import { ApiRequestError } from '../../../lib/api';
import { useAuth } from '../../auth/auth-context';
import { postTransfer } from '../api/transfers';
import type { StockItemOption } from '../api/references';
import { StockItemSelect, StockLocationSelect } from '../components/StockReferenceSelect';

function serialList(value: string) {
  return value
    .split(/[\n,]+/)
    .map((serial) => serial.trim())
    .filter(Boolean);
}

export function StockTransfersPage() {
  const { authorizedRequest } = useAuth();
  const queryClient = useQueryClient();
  const inFlight = useRef(false);
  const retry = useRef<{ fingerprint: string; key: string } | null>(null);
  const [item, setItem] = useState<StockItemOption | null>(null);
  const [fromLocationId, setFromLocationId] = useState('');
  const [toLocationId, setToLocationId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [reference, setReference] = useState('');
  const [serials, setSerials] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    setError(null);
    setSuccess(null);
    if (!item || !fromLocationId || !toLocationId) {
      setError('Select an item and both locations.');
      return;
    }
    if (fromLocationId === toLocationId) {
      setError('Choose different source and destination locations.');
      return;
    }
    const normalizedQuantity = quantity.trim();
    if (/^0+(?:\.0+)?$/.test(normalizedQuantity)) {
      setError('Quantity must be greater than zero.');
      return;
    }
    const fingerprint = JSON.stringify({
      itemId: item.id,
      fromLocationId,
      toLocationId,
      quantity: normalizedQuantity,
      reference: reference.trim(),
      serialNumbers: item.trackSerial ? serialList(serials) : [],
    });
    if (retry.current && retry.current.fingerprint !== fingerprint) {
      setError(
        'The previous transfer result is uncertain. Retry unchanged details or verify the movement history before starting a different transfer.',
      );
      return;
    }
    const key =
      retry.current?.fingerprint === fingerprint
        ? retry.current.key
        : globalThis.crypto.randomUUID();
    const input: TransferStockInput = {
      itemId: item.id,
      fromLocationId,
      toLocationId,
      quantity: normalizedQuantity,
      sourceDoc: { type: 'STOCK_TRANSFER', id: key, number: reference.trim() },
      ...(item.trackSerial ? { serialNumbers: serialList(serials) } : {}),
    };
    const parsed = transferSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter valid transfer details.');
      return;
    }
    retry.current = { fingerprint, key };
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await postTransfer(authorizedRequest, parsed.data, key);
      await queryClient.invalidateQueries({ queryKey: ['inventory'] });
      retry.current = null;
      setSuccess(
        result.replayed
          ? 'The existing transfer was found; no duplicate was posted.'
          : `Transfer posted: ${result.movements.map((movement) => movement.movementNo).join(', ')}.`,
      );
      setQuantity('');
      setReference('');
      setSerials('');
    } catch (cause) {
      if (cause instanceof ApiRequestError && [400, 403, 404, 422].includes(cause.status)) {
        retry.current = null;
      }
      setError(cause instanceof Error ? cause.message : 'The transfer could not be posted.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Stock transfers"
        description="Move stock between locations while preserving each FIFO cost slice."
      />
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {success && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800"
        >
          {success}
        </p>
      )}
      <Card title="Post a transfer">
        <p className="mb-4 text-sm text-slate-600">
          Transfers post immediately. A repeated submission of the same form reuses its idempotency
          key until the result is confirmed.
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          <StockItemSelect value={item} onChange={setItem} />
          <StockLocationSelect
            id="transfer-from"
            label="From location"
            value={fromLocationId}
            onChange={setFromLocationId}
          />
          <StockLocationSelect
            id="transfer-to"
            label="To location"
            value={toLocationId}
            onChange={setToLocationId}
          />
        </div>
        <form onSubmit={(event) => void submit(event)} className="mt-4 grid gap-4 sm:max-w-xl">
          <label className="text-sm font-medium text-slate-700">
            Quantity in {item?.baseUnit ?? 'base units'}
            <input
              type="text"
              inputMode="decimal"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              required
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Transfer reference
            <input
              type="text"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              maxLength={80}
              required
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          {item?.trackSerial && (
            <label className="text-sm font-medium text-slate-700">
              Serial numbers (one per line)
              <textarea
                value={serials}
                onChange={(event) => setSerials(event.target.value)}
                rows={4}
                required
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-fit rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy ? 'Posting…' : 'Post transfer'}
          </button>
        </form>
      </Card>
    </>
  );
}
