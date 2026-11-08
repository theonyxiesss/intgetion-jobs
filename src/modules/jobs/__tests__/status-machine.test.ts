import { describe, expect, it } from "vitest";
import {
  JOB_TRANSITIONS,
  transitionJob,
  type JobAction,
  type JobActor,
  type JobStatus,
} from "../service/status-machine";

describe("job transition table from TZ 4.3", () => {
  it("lists every legal status pair", () => {
    const legal = Object.entries(JOB_TRANSITIONS).flatMap(
      ([action, transitions]) =>
        Object.entries(transitions).map(([from, to]) => [action, from, to]),
    );
    expect(legal).toEqual(
      expect.arrayContaining([
        ["publish", "draft", "published"],
        ["approve", "pending_moderation", "published"],
        ["reject", "pending_moderation", "draft"],
        ["pause", "published", "paused"],
        ["close", "paused", "closed"],
        ["expire", "published", "expired"],
        ["extend", "expired", "published"],
        ["remove", "draft", "removed"],
      ]),
    );
    expect(legal).toHaveLength(19);
  });

  it("sends every member publish and extend to admin review (D391)", () => {
    expect(
      transitionJob({
        status: "draft",
        action: "publish",
        actor: "member",
        companyStatus: "verified",
        riskScore: 0,
      }),
    ).toBe("pending_moderation");
    expect(
      transitionJob({
        status: "paused",
        action: "extend",
        actor: "member",
        companyStatus: "verified",
        riskScore: 0,
      }),
    ).toBe("pending_moderation");
    expect(
      transitionJob({
        status: "draft",
        action: "publish",
        actor: "member",
        companyStatus: "unverified",
        riskScore: 0,
      }),
    ).toBe("pending_moderation");
    expect(
      transitionJob({
        status: "draft",
        action: "publish",
        actor: "member",
        companyStatus: "verified",
        riskScore: 4,
      }),
    ).toBe("pending_moderation");
    expect(
      transitionJob({
        status: "published",
        action: "edit",
        actor: "member",
        companyStatus: "unverified",
        riskScore: 0,
      }),
    ).toBe("pending_moderation");
    expect(
      transitionJob({
        status: "draft",
        action: "publish",
        actor: "member",
        companyStatus: "verified",
        riskScore: 0,
        sensitiveSector: true,
      }),
    ).toBe("pending_moderation");
  });

  it("enforces actor, import, and rejection reason rules for every transition", () => {
    for (const [action, transitions] of Object.entries(JOB_TRANSITIONS) as [
      JobAction,
      Partial<Record<JobStatus, JobStatus>>,
    ][]) {
      for (const status of Object.keys(transitions) as JobStatus[]) {
        const actor: JobActor = ["approve", "reject", "remove"].includes(action)
          ? "admin"
          : action === "expire"
            ? "system"
            : "member";
        const extra =
          action === "publish" || action === "extend"
            ? { companyStatus: "verified" as const, riskScore: 0 }
            : {};
        if (actor === "member")
          expect(() =>
            transitionJob({
              status,
              action,
              actor,
              source: "imported",
              reason: "review",
              ...extra,
            }),
          ).toThrow();
        else
          expect(() =>
            transitionJob({
              status,
              action,
              actor,
              source: "imported",
              reason: "review",
              ...extra,
            }),
          ).not.toThrow();
      }
    }
    expect(() =>
      transitionJob({
        status: "pending_moderation",
        action: "reject",
        actor: "admin",
      }),
    ).toThrow(/reason/);
    expect(() =>
      transitionJob({ status: "published", action: "expire", actor: "member" }),
    ).toThrow();
  });

  it("rejects all status pairs absent from the table", () => {
    const statuses: JobStatus[] = [
      "draft",
      "pending_moderation",
      "published",
      "paused",
      "expired",
      "closed",
      "removed",
    ];
    for (const action of Object.keys(JOB_TRANSITIONS) as JobAction[]) {
      for (const status of statuses) {
        if (JOB_TRANSITIONS[action][status]) continue;
        const actor: JobActor = ["approve", "reject", "remove"].includes(action)
          ? "admin"
          : action === "expire"
            ? "system"
            : "member";
        expect(() =>
          transitionJob({
            status,
            action,
            actor,
            reason: "test",
            companyStatus: "verified",
            riskScore: 0,
          }),
        ).toThrow();
      }
    }
  });
});
