// This file extends the AdapterConfig type from "@iobroker/types"

// Augment the globally declared type ioBroker.AdapterConfig
declare global {
    namespace ioBroker {
        interface AdapterConfig {
            host: string; // 1..253 chars (Req 1.1)
            port: number; // 1..65535, default 502 (Req 1.2, 1.3)
            unitId: number; // 0..247, default 1 (Req 1.4, 1.5)
            pollInterval: number; // seconds, 5..3600, default 30 (Req 5.1, 5.3)
            // --- control (Req 16) ---
            controlEnabled: boolean; // master gate, default false (Req 16.2)
            defaultStorageControlMode: number; // 0..4, written to 0xE004 on disable, default 1
            houseConsumptionStateId: string; // foreign state id (W), default ''
            wallboxConsumptionStateId: string; // foreign state id (W), default ''
            maxDischargeLimit: number; // W, positive, default 5000
            sourceMaxAgeSeconds: number; // positive int, default 120
            defaultFallbackMode: number; // 0..7, written once to 0xE00A on enable, default 1 (Req 16)
            commandTimeout: number; // seconds, written to 0xE00B on enable + renewed each cycle, default 120, must be > pollInterval (Req 16)
        }
    }
}

// this is required so the above AdapterConfig is found by TypeScript / type checking
export { };

