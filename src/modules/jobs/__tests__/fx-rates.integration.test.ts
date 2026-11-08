import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@intgetion/kit";
import { compareSalaries, USD, type FxRate } from "@intgetion/kit";
import { refreshFxRates } from "../service/fx-rates";

if (!process.env.DATABASE_URL) {
  throw new Error("Integration tests need DATABASE_URL.");
}

// One ECB observation day in the shape the feed really has.
const AS_OF = "2026-10-05";
const CSV = [
  "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE",
  `D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,${AS_OF},1.1204`,
  `D.JPY.EUR.SP00.A,D,JPY,EUR,SP00,A,${AS_OF},177.28`,
  `D.GBP.EUR.SP00.A,D,GBP,EUR,SP00,A,${AS_OF},0.8472`,
].join("\n");

afterAll(async () => {
  await getDb().execute(sql`delete from fx_rates where as_of = ${AS_OF}::date`);
});

describe("refreshFxRates (D66, D275)", () => {
  it("stores USD per one unit of the currency, not the other way round", async () => {
    const result = await refreshFxRates(
      async () =>
        new Response(CSV, { headers: { "content-type": "text/csv" } }),
    );
    expect(result.asOf).toBe(AS_OF);

    const rows = await getDb().execute<{ currency: string; rate: string }>(
      sql`select currency, rate_to_usd::text as rate from fx_rates
           where as_of = ${AS_OF}::date order by currency`,
    );
    const stored = new Map(
      [...rows].map((row) => [row.currency.trim(), row.rate]),
    );
    expect(Number(stored.get("USD"))).toBe(1);
    // 1 EUR = 1.1204 USD and 1 EUR = 177.28 JPY → 1 JPY ≈ 0.00632 USD.
    expect(Number(stored.get("JPY"))).toBeCloseTo(1.1204 / 177.28, 7);
    // The pound is worth more than a dollar, so its rate is above one.
    expect(Number(stored.get("GBP"))).toBeCloseTo(1.1204 / 0.8472, 7);
    expect(Number(stored.get("EUR"))).toBeCloseTo(1.1204, 7);

    // The stored rates make a real comparison come out right: 500 000 JPY a
    // month is about 3 160 USD, far below 5 000 USD.
    const rates: FxRate[] = [...stored].map(([currency, rate]) => ({
      currency,
      rateToUsd: rate,
      asOf: new Date(`${AS_OF}T00:00:00Z`),
    }));
    const comparison = compareSalaries(
      {
        amountMinor: BigInt(500000),
        currency: "JPY",
        period: "month",
        basis: "gross",
      },
      {
        amountMinor: BigInt(500000),
        currency: USD,
        period: "month",
        basis: "gross",
      },
      rates,
      new Date(`${AS_OF}T12:00:00Z`),
    );
    expect(comparison).toMatchObject({ comparable: true, currency: USD });
    if (comparison.comparable) {
      // About 3 160 USD. The inverted rate would give millions, and forgetting
      // that the yen has no minor units would give 31.60 USD.
      expect(comparison.jobMonthlyMinor).toBeGreaterThan(BigInt(315000));
      expect(comparison.jobMonthlyMinor).toBeLessThan(BigInt(317000));
      expect(comparison.candMonthlyMinor).toBe(BigInt(500000));
    }
  });
});
