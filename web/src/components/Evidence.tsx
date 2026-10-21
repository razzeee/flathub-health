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

export function Evidence({
  images,
  name,
  startupOnly,
  enhanced,
}: {
  images: string[];
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
        <span aria-hidden="true">–</span>
        {startupOnly
          ? "Startup-only check. No screenshot recipe requested."
          : "No screenshots available for this run."}
      </p>
    );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div className="capture-heading">
        <h4>Captured evidence</h4>
        <span>
          {images.length} {images.length === 1 ? "image" : "images"} · select to
          enlarge
        </span>
      </div>
      <div className="captures">
        {images.map((url, index) => {
          const image = (
            <img
              loading="lazy"
              src={url}
              alt={`Smoke-test capture ${index + 1} for ${name}`}
            />
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
                    aria-label={`Open capture ${index + 1} for ${name} at full size`}
                  >
                    {image}
                  </button>
                </DialogTrigger>
              ) : (
                <a
                  href={url}
                  aria-label={`Open capture ${index + 1} for ${name} at full size`}
                >
                  {image}
                </a>
              )}
              <figcaption>
                <span>CAPTURE {String(index + 1).padStart(2, "0")}</span>
                <ArrowUpRightIcon aria-hidden="true" />
              </figcaption>
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
            {name} · Capture {selected + 1}
          </DialogTitle>
          <DialogDescription>
            Smoke-test evidence, not an app-store screenshot.
          </DialogDescription>
        </DialogHeader>
        <img
          className="max-h-[65dvh] w-full object-contain"
          src={images[selected]}
          alt={`Full-size smoke-test capture ${selected + 1} for ${name}`}
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
            <a href={images[selected]}>
              Original image <ArrowUpRightIcon data-icon="inline-end" />
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
