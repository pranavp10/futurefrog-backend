import { EventSchemas } from "inngest";

// Hello World event type
type HelloWorldEvent = {
    name: "hello/world";
    data: {
        message: string;
    };
};

// Crypto Snapshot event type (for manual triggering when scheduled job is disabled)
type CryptoSnapshotManualEvent = {
    name: "crypto/snapshot.manual";
    data: {};
};

// Union all events
type AllEvents = HelloWorldEvent | CryptoSnapshotManualEvent;

export const schemas = new EventSchemas().fromUnion<AllEvents>();
