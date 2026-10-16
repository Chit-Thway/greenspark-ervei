# GreenSpark Ervei

**Challenge 3 — Essential Services Risk of Vulnerability: Early Warning and Intervention Tool.**

Help essential-service teams identify customers who may need support, understand the signals behind a flag, and decide the next step.

## Current stage

The current focus is **the first interface and the data flow around it**. Our team handles data and the interface; another teammate owns the prediction model. Managers and support workers will share the same interface initially.

This README captures the working design as of **16 October 2026**, based on the team's whiteboard sketch and current interface brief. The features below describe the intended workflow; data sources, integration contracts and implementation details are still being agreed.

## Architecture at a glance

![Architecture: customer, environmental and economic inputs feed a teammate-owned prediction model. Support need, urgency and supporting reasons flow into our shared staff interface.](docs/architecture.svg)

**Customer data + environmental data + economic data → prediction model → first interface.**

| Part | Current understanding |
| --- | --- |
| Customer data | Marked optional in the sketch. Example inputs include available account, billing, payment, usage and explicitly recorded customer information. |
| Environmental data | Weather and hazard signals, including forecast event timing and exposure. Exact feeds remain to be selected. |
| Economic data | Economic indicators and cost or affordability pressures. Exact sources and fields remain to be selected. |
| Data handling — our scope | Prepare the available inputs and connect model results to the records shown in the interface. |
| Prediction model — teammate's scope | Combine the available signals and return useful predictions such as need for support and urgency. The model implementation belongs to another teammate. |
| First interface — our scope | Turn those results into a filterable case list that managers and support workers can review and act on. |

The three input groups come from the sketch. The example fields above are illustrative rather than an agreed schema.

## First interface

The first screen is a shared staff workspace with a case list, a filter panel on the left, and bulk actions for selected cases.

| Capability | Intended behaviour |
| --- | --- |
| Support-category filters | Narrow the list using recorded circumstances such as income loss or domestic and family violence, where staff have appropriate access. |
| Urgency and support-need filters | Use model outputs to help staff prioritise cases. Exact labels and thresholds are still to be agreed. |
| Assigned to me | Show cases assigned to the signed-in support worker. Assignment comes from the case workflow. |
| Manager assignment | Let managers allocate cases to support workers within the shared interface. |
| Bulk actions | Let staff select multiple cases and act on them together. The initial action set is still to be defined. |
| Case context | Show useful model results and the supporting signals alongside relevant customer information. |

Recorded sensitive circumstances and model predictions have distinct roles: a vulnerability category such as domestic and family violence must come from an explicit record, while the model can help estimate support need and urgency. Staff retain decision authority.

## What comes back from the model

The interface needs usable results beyond raw input data. The working expectation is **need for support and urgency**. The following additional outputs are proposals to confirm with the model owner:

- Supporting signals and a short explanation for each flag.
- The relevant forecast event or time window, where applicable.
- A suggested next support step for staff to review.

Assignment, “Assigned to me,” and bulk actions belong to the interface workflow. They do not need to be predicted by the model.

## Next agreements

- Confirm the prediction target, urgency labels and the model's input/output contract with its owner.
- Confirm the data sources, including when customer data is optional and how results link to customer or case records.
- Settle the first screen's filters, manager permissions and supported bulk actions.
- Use clearly labelled mock cases for the interface prototype, then connect the agreed data flow.

The existing `customers.json` is placeholder data. Its structure does not define this architecture or the future integration contract.

## Visual references

- [Full-size architecture diagram](docs/architecture.svg) — editable SVG source.
- [Original sketch, rotated upright](docs/architecture-sketch.png).

<details>
<summary>View the rotated whiteboard sketch</summary>

![Original whiteboard sketch rotated upright: optional customer, environmental and economic inputs connect to a prediction model.](docs/architecture-sketch.png)

</details>
