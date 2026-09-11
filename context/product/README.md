# context/product — design options, before they are decisions

Forward-looking design documents: a problem, the options for solving it, what each
one costs, and what would settle the choice. Nothing here is committed to.

**How this differs from its neighbours in `context/`:**

| Where | What it holds |
|---|---|
| `context/decisions.md` | Decisions already taken, dated, append-only. The record of what was chosen and why |
| `context/internal-conversion-plan.md` + `-workplan.md` | An approved plan and its execution — work that is happening |
| `context/product/` | Options for problems not yet decided. A document graduates by producing an entry in `decisions.md`, and then stays as the reasoning behind it |

**Conventions.** One document per problem, named for the problem rather than the
favoured solution. State the constraint that forces the choice, keep the options
that were rejected and say why, and name what would change the recommendation —
that last part is what makes a document worth re-reading a quarter later.

Existing planning documents stay at `context/` root rather than moving here: they
are linked from merged pull requests and from `decisions.md`, and breaking those
links costs more than the tidiness is worth.

## Index

| Document | Question it answers | State |
|---|---|---|
| [`multi-client-access.md`](multi-client-access.md) | How does one person work across several clients' books without disconnecting and reconnecting? | Options recorded; recommendation is to wait on the operator-surface decision |
| [`qbo-actuals-pipeline.md`](qbo-actuals-pipeline.md) | How do we pull QuickBooks actuals on a schedule, with nobody in the loop? | Server side **built**: both read-only endpoints ship behind a service token. The pipeline itself is still to build |
| [`service-auth.md`](service-auth.md) | How does a scheduled job authenticate, given it cannot sign in as a person? | **Built.** Step 1 of the pipeline above; the decision is in `decisions.md` |
