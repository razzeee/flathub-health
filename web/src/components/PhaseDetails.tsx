import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr/CaretDown";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible.tsx";
import { Button } from "./ui/button.tsx";

export function PhaseDetails({
  details,
  enhanced,
}: {
  details: unknown;
  enhanced: boolean;
}) {
  const content = (
    <pre tabIndex={0} aria-label="Recorded versions and phase details">
      {JSON.stringify(details, null, 2)}
    </pre>
  );
  // Keep a working disclosure when scripts are disabled or have not loaded yet.
  if (!enhanced)
    return (
      <details>
        <summary>Versions &amp; phase details</summary>
        {content}
      </details>
    );
  return (
    <Collapsible className="min-w-0 flex-1">
      <CollapsibleTrigger asChild>
        <Button variant="link">
          <CaretDownIcon data-icon="inline-start" />
          Versions &amp; phase details
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>{content}</CollapsibleContent>
    </Collapsible>
  );
}
