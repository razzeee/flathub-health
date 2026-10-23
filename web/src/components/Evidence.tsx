import { useRef, useState } from "react";
import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowUpRight";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog.tsx";
import { Button } from "./ui/button.tsx";
import { captureLabel } from "../data.ts";
import type { Capture } from "../data.ts";

export function Evidence({
  images,
  name,
  startupOnly,
  enhanced,
}: {
  images: Capture[];
  name: string;
  startupOnly: boolean;
  enhanced: boolean;
}) {
  const [selected, setSelected] = useState(0);
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  if (!images.length)
    return (
      <p className="empty-captures">
        {startupOnly
          ? "No screenshot recipe requested."
          : "No screenshots available."}
      </p>
    );
  const current = images[selected]!;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div className="capture-heading">
        <h4>Screenshots</h4>
        <span>
          {images.length} {images.length === 1 ? "image" : "images"}
        </span>
      </div>
      <div className="captures">
        {images.map((capture, index) => {
          const { url, description } = capture;
          const label = captureLabel(capture);
          const image = (
            <img loading="lazy" src={url} alt={`${name} · ${label}`} />
          );
          return (
            <figure key={url}>
              {enhanced ? (
                <DialogTrigger asChild>
                  <button
                    type="button"
                    className="capture-trigger"
                    onClick={(event) => {
                      opener.current = event.currentTarget;
                      setSelected(index);
                    }}
                    aria-label={`Open ${label} for ${name} at full size`}
                  >
                    {image}
                  </button>
                </DialogTrigger>
              ) : (
                <a
                  href={url}
                  aria-label={`Open ${label} for ${name} at full size`}
                >
                  {image}
                </a>
              )}
              <figcaption>
                <span>{label}</span>
                <ArrowUpRightIcon aria-hidden="true" />
              </figcaption>
              <p className="capture-scope">
                {capture.phase === "verify"
                  ? "Startup capture, possibly a splash or welcome screen."
                  : "Recipe capture. Check against the recipe steps."}
              </p>
              {description ? (
                <p className="capture-description">{description}</p>
              ) : null}
            </figure>
          );
        })}
      </div>
      <DialogContent
        className="w-[calc(100%-2rem)] sm:max-w-5xl max-h-[calc(100dvh-2rem)] overflow-y-auto"
        onCloseAutoFocus={(event) => {
          // Several image triggers share this viewer; return to the one used.
          event.preventDefault();
          opener.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {name} · {captureLabel(current)}
          </DialogTitle>
          <DialogDescription>
            {current.description ??
              "Test capture. Check against the recipe steps or startup result."}
          </DialogDescription>
        </DialogHeader>
        <img
          className="max-h-[65dvh] w-full object-contain"
          src={current.url}
          alt={`${name} · ${captureLabel(current)}`}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={selected === 0}
              onClick={() => setSelected((i) => i - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              disabled={selected === images.length - 1}
              onClick={() => setSelected((i) => i + 1)}
            >
              Next
            </Button>
          </div>
          <Button asChild variant="link">
            <a href={current.url}>
              Original image <ArrowUpRightIcon data-icon="inline-end" />
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
