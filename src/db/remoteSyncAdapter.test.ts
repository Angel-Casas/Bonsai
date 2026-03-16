/**
 * Unit tests for RemoteSyncAdapter — pushes/pulls encrypted ops to/from server
 *
 * Mocks:
 * - globalThis.fetch for HTTP requests
 * - opsService for IndexedDB operations (not available in test env)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SyncOp } from './types';

// Mock opsService before importing RemoteSyncAdapter
vi.mock('./opsService', () => ({
  getPendingOps: vi.fn(),
  markAcked: vi.fn(),
}));

import { RemoteSyncAdapter } from './remoteSyncAdapter';
import { getPendingOps, markAcked } from './opsService';

const mockGetPendingOps = vi.mocked(getPendingOps);
const mockMarkAcked = vi.mocked(markAcked);

// Mock fetch
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

function createMockOp(overrides: Partial<SyncOp> = {}): SyncOp {
  return {
    id: 'op-1',
    createdAt: '2026-02-24T00:00:00.000Z',
    conversationId: 'conv-1',
    type: 'message.create',
    payload: JSON.stringify({ content: 'hello' }),
    payloadEnc: null,
    status: 'pending',
    clientId: 'client-abc',
    schemaVersion: 1,
    ...overrides,
  };
}

describe('RemoteSyncAdapter', () => {
  let adapter: RemoteSyncAdapter;
  let getToken: ReturnType<typeof vi.fn<() => Promise<string | null>>>;

  beforeEach(() => {
    getToken = vi.fn<() => Promise<string | null>>().mockResolvedValue('valid-token');
    adapter = new RemoteSyncAdapter('https://sync.example.com', getToken);
    mockFetch.mockReset();
    mockGetPendingOps.mockReset();
    mockMarkAcked.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // pushPendingOps
  // ==========================================================================

  describe('pushPendingOps', () => {
    it('returns { pushed: 0, failed: 0 } when no token', async () => {
      getToken.mockResolvedValue(null);

      const result = await adapter.pushPendingOps();

      expect(result).toEqual({ pushed: 0, failed: 0 });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns { pushed: 0, failed: 0 } when no pending ops', async () => {
      mockGetPendingOps.mockResolvedValue([]);

      const result = await adapter.pushPendingOps();

      expect(result).toEqual({ pushed: 0, failed: 0 });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('fetches ops with batch limit of 50', async () => {
      mockGetPendingOps.mockResolvedValue([]);

      await adapter.pushPendingOps();

      expect(mockGetPendingOps).toHaveBeenCalledWith(50);
    });

    it('maps ops to server wire format with base64 payload', async () => {
      const op = createMockOp({
        id: 'op-1',
        clientId: 'client-abc',
        conversationId: 'conv-1',
        createdAt: '2026-02-24T00:00:00.000Z',
        payload: JSON.stringify({ content: 'hello' }),
        payloadEnc: null,
      });
      mockGetPendingOps.mockResolvedValue([op]);
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ pushed: 1 }),
      });

      await adapter.pushPendingOps();

      const callArgs = mockFetch.mock.calls[0]!;
      const body = JSON.parse(callArgs[1].body);
      expect(body.ops).toHaveLength(1);
      expect(body.ops[0]).toEqual({
        id: 'op-1',
        clientId: 'client-abc',
        encryptedPayload: btoa(JSON.stringify({ content: 'hello' })),
        conversationId: 'conv-1',
        createdAt: '2026-02-24T00:00:00.000Z',
      });
      // Should NOT contain local-only fields
      expect(body.ops[0]).not.toHaveProperty('status');
      expect(body.ops[0]).not.toHaveProperty('type');
      expect(body.ops[0]).not.toHaveProperty('schemaVersion');
      expect(body.ops[0]).not.toHaveProperty('payload');
      expect(body.ops[0]).not.toHaveProperty('payloadEnc');
    });

    it('maps encrypted ops using payloadEnc when present', async () => {
      const op = createMockOp({
        payload: '',
        payloadEnc: { ciphertext: 'abc123', iv: 'def456' },
      });
      mockGetPendingOps.mockResolvedValue([op]);
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ pushed: 1 }),
      });

      await adapter.pushPendingOps();

      const callArgs = mockFetch.mock.calls[0]!;
      const body = JSON.parse(callArgs[1].body);
      expect(body.ops[0].encryptedPayload).toBe(
        btoa(JSON.stringify({ ciphertext: 'abc123', iv: 'def456' })),
      );
    });

    it('marks ops as acked after successful push', async () => {
      const op1 = createMockOp({ id: 'op-1' });
      const op2 = createMockOp({ id: 'op-2' });
      mockGetPendingOps.mockResolvedValue([op1, op2]);
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ pushed: 2 }),
      });

      const result = await adapter.pushPendingOps();

      expect(mockMarkAcked).toHaveBeenCalledWith(['op-1', 'op-2']);
      expect(result).toEqual({ pushed: 2, failed: 0 });
    });

    it('handles partial push from server', async () => {
      const op1 = createMockOp({ id: 'op-1' });
      const op2 = createMockOp({ id: 'op-2' });
      mockGetPendingOps.mockResolvedValue([op1, op2]);
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ pushed: 1 }),
      });

      const result = await adapter.pushPendingOps();

      // Only first op should be marked acked
      expect(mockMarkAcked).toHaveBeenCalledWith(['op-1']);
      expect(result).toEqual({ pushed: 1, failed: 1 });
    });

    it('returns all as failed when server returns HTTP error', async () => {
      const op1 = createMockOp({ id: 'op-1' });
      mockGetPendingOps.mockResolvedValue([op1]);
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = await adapter.pushPendingOps();

      expect(result).toEqual({ pushed: 0, failed: 1 });
      expect(mockMarkAcked).not.toHaveBeenCalled();
    });

    it('returns all as failed when fetch throws', async () => {
      const op1 = createMockOp({ id: 'op-1' });
      mockGetPendingOps.mockResolvedValue([op1]);
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await adapter.pushPendingOps();

      expect(result).toEqual({ pushed: 0, failed: 1 });
      expect(mockMarkAcked).not.toHaveBeenCalled();
    });

    it('uses Authorization header with token', async () => {
      getToken.mockResolvedValue('my-secret-token');
      mockGetPendingOps.mockResolvedValue([createMockOp()]);
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ pushed: 1 }),
      });

      await adapter.pushPendingOps();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer my-secret-token',
          }),
        }),
      );
    });
  });

  // ==========================================================================
  // pullRemoteOps
  // ==========================================================================

  describe('pullRemoteOps', () => {
    it('returns [] when no token', async () => {
      getToken.mockResolvedValue(null);

      const result = await adapter.pullRemoteOps('client-abc');

      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('constructs correct query params with clientId only', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ops: [] }),
      });

      await adapter.pullRemoteOps('client-abc');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://sync.example.com/sync/pull?clientId=client-abc',
        {
          method: 'GET',
          headers: {
            Authorization: 'Bearer valid-token',
          },
        },
      );
    });

    it('constructs correct query params with clientId and since', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ops: [] }),
      });

      await adapter.pullRemoteOps('client-abc', '2026-02-20T00:00:00.000Z');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://sync.example.com/sync/pull?clientId=client-abc&since=2026-02-20T00%3A00%3A00.000Z',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('returns remote ops from server response', async () => {
      const remoteOp = {
        id: 'remote-op-1',
        clientId: 'other-client',
        encryptedPayload: btoa('encrypted-data'),
        conversationId: 'conv-1',
        createdAt: '2026-02-24T00:00:00.000Z',
      };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ops: [remoteOp] }),
      });

      const result = await adapter.pullRemoteOps('client-abc');

      expect(result).toEqual([remoteOp]);
    });

    it('returns [] when server returns HTTP error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const result = await adapter.pullRemoteOps('client-abc');

      expect(result).toEqual([]);
    });

    it('returns [] when fetch throws', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await adapter.pullRemoteOps('client-abc');

      expect(result).toEqual([]);
    });
  });

  // ==========================================================================
  // markAcked (delegation)
  // ==========================================================================

  describe('markAcked', () => {
    it('delegates to local opsService', async () => {
      await adapter.markAcked(['op-1', 'op-2']);

      expect(mockMarkAcked).toHaveBeenCalledWith(['op-1', 'op-2']);
    });
  });

  // ==========================================================================
  // getPendingOps (delegation)
  // ==========================================================================

  describe('getPendingOps', () => {
    it('delegates to local opsService without limit', async () => {
      const ops = [createMockOp()];
      mockGetPendingOps.mockResolvedValue(ops);

      const result = await adapter.getPendingOps();

      expect(mockGetPendingOps).toHaveBeenCalledWith(undefined);
      expect(result).toEqual(ops);
    });

    it('delegates to local opsService with limit', async () => {
      mockGetPendingOps.mockResolvedValue([]);

      await adapter.getPendingOps({ limit: 10 });

      expect(mockGetPendingOps).toHaveBeenCalledWith(10);
    });
  });

  // ==========================================================================
  // resetSyncState (delegation)
  // ==========================================================================

  describe('resetSyncState', () => {
    it('marks all pending ops as acked', async () => {
      const ops = [
        createMockOp({ id: 'op-1' }),
        createMockOp({ id: 'op-2' }),
      ];
      mockGetPendingOps.mockResolvedValue(ops);

      await adapter.resetSyncState();

      expect(mockGetPendingOps).toHaveBeenCalled();
      expect(mockMarkAcked).toHaveBeenCalledWith(['op-1', 'op-2']);
    });

    it('does nothing when no pending ops', async () => {
      mockGetPendingOps.mockResolvedValue([]);

      await adapter.resetSyncState();

      expect(mockMarkAcked).not.toHaveBeenCalled();
    });
  });
});
