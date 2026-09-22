import { expect } from 'chai';
import fc from 'fast-check';
import type { IModbusClient, ModbusReadOptions, ModbusWriteOptions } from './modbus-client';
import { ModbusClient } from './modbus-client';
import type { InverterModelId, MeterModelId } from './sunspec-reader';
import { SunSpecReader } from './sunspec-reader';

// ---------------------------------------------------------------------------
// Feature: storedge-battery-control, Property 1: Read-only when control is disabled
// Validates: Requirements 3.1, 3.2, 2.7
//
// The client is no longer *strictly* read-only. Its write surface is restricted
// to EXACTLY the FC06 single-register and FC16 multiple-register operations
// (`writeSingleRegister`/`writeMultipleRegisters`, backed by the library
// `writeRegister`/`writeRegisters`). No coil write (FC05/FC15) or any other write
// function code is exposed (Req 3.1, 3.2). FC03/FC04 read behavior is unchanged,
// so over any sequence of *reader* operations only read function codes are ever
// issued — no write is emitted while control is disabled (Req 2.7).
// ---------------------------------------------------------------------------

// The set of method names the read client legitimately exposes for reads and
// connection management. Every read-path call recorded by the RecordingClient
// must be one of these.
const ALLOWED_READ_CALLS = ['connect', 'close', 'isConnected', 'readHoldingRegisters', 'readInputRegisters'];

// The restricted write surface the client is allowed to expose: EXACTLY the FC06
// single-register and FC16 multiple-register operations, plus the underlying
// library method names they forward to (Req 3.1).
const ALLOWED_WRITE_METHODS = [
    'writeSingleRegister', // FC06 (public surface)
    'writeMultipleRegisters', // FC16 (public surface)
    'writeRegister', // FC06 (library forwarding target)
    'writeRegisters', // FC16 (library forwarding target)
];

// Coil write methods (FC05/FC15) and any other write function code must never be
// present on the client surface, nor ever recorded as a call (Req 3.2). The FC06/
// FC16 register writes are deliberately NOT in this list — they are allowed.
const FORBIDDEN_WRITE_METHODS = [
    'writeCoil',
    'writeCoils',
    'writeSingleCoil',
    'writeMultipleCoils',
    'writeFC5',
    'writeFC15',
];

/**
 * A test double implementing {@link IModbusClient} that records the name of every
 * method invoked. Reads return canned data: an array of the requested length whose
 * first element is `firstWord` (so detection reads can report a valid SunSpec model
 * id) and whose remaining elements are 0. No real socket is opened.
 */
class RecordingClient implements IModbusClient {
    readonly calls: string[] = [];
    private connected = false;
    /** Value returned as the first register of every read (drives model detection). */
    private readonly firstWord: number;

    constructor(firstWord: number) {
        this.firstWord = firstWord;
    }

    connect(_host: string, _port: number, _unitId: number, _timeoutMs?: number): Promise<void> {
        this.calls.push('connect');
        this.connected = true;
        return Promise.resolve();
    }

    readHoldingRegisters(_address: number, length: number, _opts?: ModbusReadOptions): Promise<number[]> {
        this.calls.push('readHoldingRegisters');
        return Promise.resolve(this.cannedData(length));
    }

    readInputRegisters(_address: number, length: number, _opts?: ModbusReadOptions): Promise<number[]> {
        this.calls.push('readInputRegisters');
        return Promise.resolve(this.cannedData(length));
    }

    writeSingleRegister(_address: number, _value: number, _opts?: ModbusWriteOptions): Promise<void> {
        this.calls.push('writeSingleRegister');
        return Promise.resolve();
    }

    writeMultipleRegisters(_address: number, _values: number[], _opts?: ModbusWriteOptions): Promise<void> {
        this.calls.push('writeMultipleRegisters');
        return Promise.resolve();
    }

    isConnected(): boolean {
        this.calls.push('isConnected');
        return this.connected;
    }

    close(): Promise<void> {
        this.calls.push('close');
        this.connected = false;
        return Promise.resolve();
    }

    /**
     * An array of `length` words: first element `firstWord`, the rest zero.
     *
     * @param length
     */
    private cannedData(length: number): number[] {
        const data = new Array<number>(Math.max(length, 0)).fill(0);
        if (length >= 1) {
            data[0] = this.firstWord;
        }
        return data;
    }
}

/** The reader operations the property drives, each against a fresh client. */
type Op =
    | { kind: 'detectInverterModel' }
    | { kind: 'detectMeterModel' }
    | { kind: 'readInverter'; model: InverterModelId }
    | { kind: 'readMeter'; model: MeterModelId };

const inverterModels: InverterModelId[] = [101, 102, 103];
const meterModels: MeterModelId[] = [201, 202, 203, 204];

const RUNS = { numRuns: 100 };

describe('modbus-client', () => {
    describe('Feature: storedge-battery-control, Property 1: Read-only when control is disabled', () => {
        it('Feature: storedge-battery-control, Property 1: reads never issue a write', async () => {
            // Generator for an arbitrary reader operation with a random valid model.
            const opArb: fc.Arbitrary<Op> = fc.oneof(
                fc.constant<Op>({ kind: 'detectInverterModel' }),
                fc.constant<Op>({ kind: 'detectMeterModel' }),
                fc.constantFrom(...inverterModels).map<Op>(model => ({ kind: 'readInverter', model })),
                fc.constantFrom(...meterModels).map<Op>(model => ({ kind: 'readMeter', model })),
            );

            // The first word each read returns. Using a valid inverter DID (101) lets
            // detectInverterModel succeed; detectMeterModel simply returns null for that
            // value, which still exercises the read path without any writes.
            const firstWordArb = fc.constantFrom(101, 102, 103, 201, 202, 203, 204, 0, 0xffff);

            await fc.assert(
                fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 12 }), firstWordArb, async (ops, first) => {
                    const client = new RecordingClient(first);
                    const reader = new SunSpecReader();

                    for (const op of ops) {
                        switch (op.kind) {
                            case 'detectInverterModel':
                                await reader.detectInverterModel(client);
                                break;
                            case 'detectMeterModel':
                                await reader.detectMeterModel(client);
                                break;
                            case 'readInverter':
                                await reader.readInverter(client, op.model);
                                break;
                            case 'readMeter':
                                await reader.readMeter(client, op.model);
                                break;
                        }
                    }

                    // Over any sequence of reader operations, only read/connection-management
                    // calls are recorded — FC03/FC04 only, never a write of any kind. The
                    // reader must not issue even the now-allowed FC06/FC16 writes (Req 2.7).
                    for (const call of client.calls) {
                        expect(ALLOWED_READ_CALLS, `unexpected call "${call}"`).to.include(call);
                        expect(ALLOWED_WRITE_METHODS, `read path issued a write call "${call}"`).to.not.include(call);
                        expect(FORBIDDEN_WRITE_METHODS, `write call "${call}" was issued`).to.not.include(call);
                    }
                }),
                RUNS,
            );
        });

        // -------------------------------------------------------------------
        // Static write-surface guard: the ModbusClient class (and thus the
        // IModbusClient contract it implements) exposes EXACTLY the FC06/FC16
        // register-write surface {writeSingleRegister, writeMultipleRegisters}
        // beyond the reads, and no coil write (FC05/FC15) or any other write
        // function code — neither on the instance nor its prototype chain
        // (Req 3.1, 3.2).
        // -------------------------------------------------------------------
        it('Feature: storedge-battery-control, Property 1: ModbusClient exposes only the FC06/FC16 write surface', () => {
            const client = new ModbusClient();

            // No coil write (FC05/FC15) or other write function code is exposed (Req 3.2).
            for (const name of FORBIDDEN_WRITE_METHODS) {
                expect((client as any)[name], `ModbusClient should not expose "${name}"`).to.equal(undefined);
            }

            // The allowed write surface is exactly the two FC06/FC16 register writes (Req 3.1).
            for (const name of ['writeSingleRegister', 'writeMultipleRegisters']) {
                expect((client as any)[name], `ModbusClient should expose "${name}"`).to.be.a('function');
            }

            // The read/connection-management surface is unchanged (Req 2.7).
            for (const name of ALLOWED_READ_CALLS) {
                expect((client as any)[name], `ModbusClient should expose "${name}"`).to.be.a('function');
            }
        });
    });
});

// ===========================================================================
// TASK 1.3 — Write forwarding (FC06/FC16), function-code selection, and
// not-connected rejection. These properties exercise the REAL ModbusClient and
// verify what it forwards to the underlying `modbus-serial` library. Because
// ModbusClient constructs its own ModbusRTU internally, we inject a recording
// library double into its private `client` field (mirroring how the read side
// is wrapped) so every library-level call is captured.
// ===========================================================================

/** A single recorded library-level call: the modbus-serial method + its args. */
interface LibCall {
    method: string;
    args: unknown[];
}

/**
 * Recording test double for the underlying `modbus-serial` client. It captures
 * every method the ModbusClient forwards to (writeRegister/writeRegisters plus
 * the read/connection surface) so a property can assert EXACTLY which library
 * function code was issued with which arguments. No socket is opened.
 */
class RecordingLibClient {
    readonly libCalls: LibCall[] = [];
    isOpen = false;

    setID(_id: number): void {
        this.libCalls.push({ method: 'setID', args: [_id] });
    }

    setTimeout(_ms: number): void {
        this.libCalls.push({ method: 'setTimeout', args: [_ms] });
    }

    writeRegister(address: number, value: number): Promise<{ address: number; value: number }> {
        this.libCalls.push({ method: 'writeRegister', args: [address, value] });
        return Promise.resolve({ address, value });
    }

    writeRegisters(address: number, values: number[]): Promise<{ address: number; length: number }> {
        this.libCalls.push({ method: 'writeRegisters', args: [address, values] });
        return Promise.resolve({ address, length: values.length });
    }

    readHoldingRegisters(address: number, length: number): Promise<{ data: number[] }> {
        this.libCalls.push({ method: 'readHoldingRegisters', args: [address, length] });
        return Promise.resolve({ data: new Array<number>(length).fill(0) });
    }

    readInputRegisters(address: number, length: number): Promise<{ data: number[] }> {
        this.libCalls.push({ method: 'readInputRegisters', args: [address, length] });
        return Promise.resolve({ data: new Array<number>(length).fill(0) });
    }
}

/**
 * Build a real {@link ModbusClient} whose private `client` is the given recording
 * library double and whose `connected` flag is forced to `connected`. This lets a
 * test observe exactly what the client forwards to the library without a socket.
 *
 * @param lib the recording library double to inject
 * @param connected the value to force the client's internal connected flag to
 */
function makeInjectedClient(lib: RecordingLibClient, connected: boolean): ModbusClient {
    const client = new ModbusClient();
    lib.isOpen = connected;
    // Inject the recording library and force the internal connected flag; isConnected()
    // is `connected && client.isOpen`, so both must agree for the client to be "connected".
    (client as any).client = lib;
    (client as any).connected = connected;
    return client;
}

/** The set of library write methods; a write property must issue exactly one of these. */
const LIB_WRITE_METHODS = ['writeRegister', 'writeRegisters'];

describe('modbus-client — write forwarding & guards', () => {
    describe('Feature: storedge-battery-control, Property 2: FC06/FC16 forwarding and function-code selection', () => {
        it('Feature: storedge-battery-control, Property 2: FC06/FC16 forwarding and function-code selection', async () => {
            const addressArb = fc.integer({ min: 0, max: 0xffff });
            const uint16Arb = fc.integer({ min: 0, max: 0xffff });
            const wordArrayArb = fc.array(uint16Arb, { minLength: 1, maxLength: 8 });

            // FC06 arm: writeSingleRegister(address, v) forwards EXACTLY (address, v)
            // to the library writeRegister and issues no other write.
            await fc.assert(
                fc.asyncProperty(addressArb, uint16Arb, async (address, value) => {
                    const lib = new RecordingLibClient();
                    const client = makeInjectedClient(lib, true);

                    await client.writeSingleRegister(address, value);

                    const writes = lib.libCalls.filter(c => LIB_WRITE_METHODS.includes(c.method));
                    expect(writes.length, 'exactly one library write must be issued').to.equal(1);
                    expect(writes[0].method, 'FC06 must forward to writeRegister').to.equal('writeRegister');
                    expect(writes[0].args, 'writeRegister must receive exactly (address, value)').to.deep.equal([
                        address,
                        value,
                    ]);
                    // No FC16 (writeRegisters) may be issued for a single-register write.
                    expect(
                        lib.libCalls.some(c => c.method === 'writeRegisters'),
                        'writeSingleRegister must not issue writeRegisters',
                    ).to.equal(false);
                }),
                RUNS,
            );

            // FC16 arm: writeMultipleRegisters(address, words) forwards EXACTLY
            // (address, words) to the library writeRegisters and issues no other write.
            await fc.assert(
                fc.asyncProperty(addressArb, wordArrayArb, async (address, words) => {
                    const lib = new RecordingLibClient();
                    const client = makeInjectedClient(lib, true);

                    await client.writeMultipleRegisters(address, words);

                    const writes = lib.libCalls.filter(c => LIB_WRITE_METHODS.includes(c.method));
                    expect(writes.length, 'exactly one library write must be issued').to.equal(1);
                    expect(writes[0].method, 'FC16 must forward to writeRegisters').to.equal('writeRegisters');
                    expect(writes[0].args, 'writeRegisters must receive exactly (address, words)').to.deep.equal([
                        address,
                        words,
                    ]);
                    // No FC06 (writeRegister) may be issued for a multi-register write.
                    expect(
                        lib.libCalls.some(c => c.method === 'writeRegister'),
                        'writeMultipleRegisters must not issue writeRegister',
                    ).to.equal(false);
                }),
                RUNS,
            );
        });
    });

    describe('Feature: storedge-battery-control, Property 3: Writes are rejected when not connected', () => {
        it('Feature: storedge-battery-control, Property 3: Writes are rejected when not connected', async () => {
            type WriteKind =
                { kind: 'FC06'; address: number; value: number } | { kind: 'FC16'; address: number; words: number[] };

            const writeKindArb: fc.Arbitrary<WriteKind> = fc.oneof(
                fc.record({
                    kind: fc.constant<'FC06'>('FC06'),
                    address: fc.integer({ min: 0, max: 0xffff }),
                    value: fc.integer({ min: 0, max: 0xffff }),
                }),
                fc.record({
                    kind: fc.constant<'FC16'>('FC16'),
                    address: fc.integer({ min: 0, max: 0xffff }),
                    words: fc.array(fc.integer({ min: 0, max: 0xffff }), { minLength: 1, maxLength: 8 }),
                }),
            );

            await fc.assert(
                fc.asyncProperty(writeKindArb, async op => {
                    const lib = new RecordingLibClient();
                    // Not connected: isConnected() must be false, so no library call is issued.
                    const client = makeInjectedClient(lib, false);

                    let rejected = false;
                    let message = '';
                    try {
                        if (op.kind === 'FC06') {
                            await client.writeSingleRegister(op.address, op.value);
                        } else {
                            await client.writeMultipleRegisters(op.address, op.words);
                        }
                    } catch (err) {
                        rejected = true;
                        message = err instanceof Error ? err.message : String(err);
                    }

                    expect(rejected, 'a write while not connected must reject').to.equal(true);
                    expect(message, 'rejection must be descriptive about the connection').to.match(/not connected/i);
                    // No underlying library write method may have been called.
                    for (const m of LIB_WRITE_METHODS) {
                        expect(
                            lib.libCalls.some(c => c.method === m),
                            `library "${m}" must not be called while not connected`,
                        ).to.equal(false);
                    }
                }),
                RUNS,
            );
        });
    });

    describe('modbus-client write timeout race (example)', () => {
        // The 10s timeout race path bounds a write: a write whose underlying library
        // call never resolves must reject via the timeout. We use a short timeoutMs
        // and a never-resolving library stub so the test is deterministic and fast.
        it('rejects a write whose underlying library call never resolves (timeout race)', async () => {
            const neverResolves = (): Promise<never> => new Promise<never>(() => {});

            const stub = {
                isOpen: true,
                setID(_id: number): void {},
                setTimeout(_ms: number): void {},
                writeRegister: neverResolves,
                writeRegisters: neverResolves,
            };

            const client = new ModbusClient();
            (client as any).client = stub;
            (client as any).connected = true;

            let rejected = false;
            let message = '';
            try {
                await client.writeSingleRegister(0xe004, 4, { timeoutMs: 20 });
            } catch (err) {
                rejected = true;
                message = err instanceof Error ? err.message : String(err);
            }

            expect(rejected, 'a write that never resolves must reject via the timeout').to.equal(true);
            expect(message, 'rejection should mention the timeout').to.match(/timed out/i);
        });
    });
});
