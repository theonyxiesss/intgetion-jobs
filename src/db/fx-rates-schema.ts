import { char, date, numeric, pgTable, primaryKey } from "drizzle-orm/pg-core";

export const fxRates = pgTable(
  "fx_rates",
  {
    currency: char("currency", { length: 3 }).notNull(),
    rateToUsd: numeric("rate_to_usd", { precision: 18, scale: 8 }).notNull(),
    asOf: date("as_of", { mode: "date" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.currency, table.asOf] })],
);
