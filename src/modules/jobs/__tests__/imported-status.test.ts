import { describe, expect, it } from "vitest";
import {
  importedPlace,
  importedStatusAfterFeed,
} from "../service/imported-jobs";

describe("status an import leaves behind (D412)", () => {
  it("never brings back a job a person removed, closed or paused", () => {
    for (const previous of ["removed", "closed", "paused"] as const) {
      for (const next of ["published", "expired", "removed"] as const) {
        expect(
          importedStatusAfterFeed({ previous, next, sensitive: false }),
        ).toBeNull();
      }
    }
  });

  it("publishes a new job and brings back one that only expired", () => {
    expect(
      importedStatusAfterFeed({
        previous: null,
        next: "published",
        sensitive: false,
      }),
    ).toBe("published");
    expect(
      importedStatusAfterFeed({
        previous: "expired",
        next: "published",
        sensitive: false,
      }),
    ).toBe("published");
  });

  it("sends a sensitive job to an admin once, not again after approval", () => {
    expect(
      importedStatusAfterFeed({
        previous: null,
        next: "published",
        sensitive: true,
      }),
    ).toBe("pending_moderation");
    expect(
      importedStatusAfterFeed({
        previous: "published",
        next: "published",
        sensitive: true,
      }),
    ).toBe("published");
    expect(
      importedStatusAfterFeed({
        previous: "pending_moderation",
        next: "published",
        sensitive: false,
      }),
    ).toBe("pending_moderation");
  });

  it("still lets the feed remove or expire a published job", () => {
    expect(
      importedStatusAfterFeed({
        previous: "published",
        next: "removed",
        sensitive: false,
      }),
    ).toBe("removed");
    expect(
      importedStatusAfterFeed({
        previous: "published",
        next: "expired",
        sensitive: false,
      }),
    ).toBe("expired");
  });
});

describe("place an import writes (D416)", () => {
  it("puts an office job in its country and keeps a remote one open to its countries", () => {
    expect(
      importedPlace({
        workFormat: "onsite",
        location: "Dublin",
        countries: ["IE"],
      }),
    ).toEqual({
      workFormat: "onsite",
      location: "Dublin",
      locationCountry: "IE",
      countryRestrictions: null,
    });
    expect(
      importedPlace({
        workFormat: "remote",
        location: "Remote - US",
        countries: ["US", "CA"],
      }),
    ).toEqual({
      workFormat: "remote",
      location: "Remote - US",
      locationCountry: null,
      countryRestrictions: ["US", "CA"],
    });
  });

  it("publishes an office job without a place as remote, and drops bad codes", () => {
    expect(importedPlace({ workFormat: "hybrid", location: " " })).toEqual({
      workFormat: "remote",
      location: null,
      locationCountry: null,
      countryRestrictions: null,
    });
    expect(importedPlace({}).workFormat).toBe("remote");
    expect(
      importedPlace({ workFormat: "remote", countries: ["usa", "U1"] })
        .countryRestrictions,
    ).toBeNull();
  });
});
