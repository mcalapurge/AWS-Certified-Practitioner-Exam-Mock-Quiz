import { Fragment } from "react";

const URL_RE = /(https?:\/\/[^\s<>")]+)/g;

interface Props {
  text: string;
  className?: string;
}

// Renders plain text with embedded URLs converted to safe external links.
// Long URLs wrap via `break-words` so they don't overflow the container.
export function RichText({ text, className }: Props) {
  const parts = text.split(URL_RE);
  return (
    <p className={`break-words ${className ?? ""}`}>
      {parts.map((part, i) => {
        if (i % 2 === 1) {
          return (
            <a
              key={i}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 hover:no-underline"
            >
              {part}
            </a>
          );
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </p>
  );
}
