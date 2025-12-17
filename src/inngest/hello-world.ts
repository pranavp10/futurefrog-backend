import { inngest } from "./client";

export const helloWorld = inngest.createFunction(
    { id: "hello-world" },
    { event: "hello/world" },
    async ({ event, step }) => {
        await step.run("log-message", async () => {
            console.log(`Hello World! Message: ${event.data.message}`);
            return { received: event.data.message };
        });

        return { success: true, message: event.data.message };
    }
);
