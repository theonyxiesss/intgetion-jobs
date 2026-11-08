import { logger } from "@intgetion/kit";
import { jobsPorts } from "../../../ports";
import { transitionOwnedJob as transitionInRepo } from "../repo/jobs-repo";

type TransitionArgs = Parameters<typeof transitionInRepo>;

const PUBLISH_ACTIONS = new Set(["publish", "approve", "extend"]);

/** Closes through the existing machine, then tells active candidates (D128). */
export async function transitionOwnedJob(
  ...args: TransitionArgs
): Promise<Awaited<ReturnType<typeof transitionInRepo>>> {
  const job = await transitionInRepo(...args);
  const action = args[1];
  const ports = jobsPorts();
  // Search engines hear about the change right away (D284). Fire and forget:
  // a refused ping must never fail publishing.
  void ports.submitToIndexNow([`/jobs/${job.id}`]).catch((error) => {
    logger.warn({ err: error }, "jobs: indexnow ping failed");
  });
  if (PUBLISH_ACTIONS.has(action) && job.status === "published") {
    await ports.enqueueMatchJob(job.id);
  }
  if (job.status === "closed") {
    const recipientIds = await ports.activeCandidateIds(job.id);
    await ports.notify("job.closed", recipientIds, {
      jobId: job.id,
      jobTitle: job.title,
    });
  }
  return job;
}
