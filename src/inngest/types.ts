import { EventSchemas } from "inngest";

// Hello World event type
type HelloWorldEvent = {
    name: "hello/world";
    data: {
        message: string;
    };
};

// Crypto Snapshot event type (for manual triggering)
type CryptoSnapshotEvent = {
    name: "crypto/snapshot";
    data: {};
};

// Union all events
type AllEvents = HelloWorldEvent | CryptoSnapshotEvent;

export const schemas = new EventSchemas().fromUnion<AllEvents>();
