import { pgTable, text, timestamp, serial } from 'drizzle-orm/pg-core';

export const globalParams = pgTable('global_params', {
    id: serial('id').primaryKey(),
    paramTitle: text('param_title').notNull(),
    paramValue: text('param_value').notNull(),
    createdAt: timestamp('created_at')
        .defaultNow()
        .notNull(),
    updatedAt: timestamp('updated_at')
        .defaultNow()
        .notNull(),
});

// Type inference helpers
export type GlobalParam = typeof globalParams.$inferSelect;
export type NewGlobalParam = typeof globalParams.$inferInsert;






