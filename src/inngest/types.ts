import { EventSchemas } from "inngest";

// Hello World event type
type HelloWorldEvent = {
    name: "hello/world";
    data: {
        message: string;
    };
};

// Union all events
type AllEvents = HelloWorldEvent;

export const schemas = new EventSchemas().fromUnion<AllEvents>();
