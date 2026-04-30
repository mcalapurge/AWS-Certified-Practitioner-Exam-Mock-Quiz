import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

interface Props {
  content: string;
  className?: string;
}

// Renders study-note markdown with GFM extensions (tables, strikethrough,
// task lists). External links open in a new tab; relative links are dropped
// since the original notes link to anchors that don't exist in our context.
export function MarkdownView({ content, className }: Props) {
  return (
    <div
      className={cn(
        "prose prose-slate max-w-none",
        "prose-headings:scroll-mt-20 prose-headings:font-semibold",
        "prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg",
        "prose-a:text-primary prose-a:underline-offset-2",
        "prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:font-mono prose-code:text-[0.85em] prose-code:before:hidden prose-code:after:hidden",
        "prose-pre:bg-muted prose-pre:text-foreground prose-pre:border",
        "prose-table:text-sm",
        "prose-img:my-3",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...rest }) => {
            const isExternal = !!href && /^https?:\/\//.test(href);
            const isAnchor = !!href && href.startsWith("#");
            if (!isExternal && !isAnchor) {
              return <span>{children}</span>;
            }
            return (
              <a
                href={href}
                target={isExternal ? "_blank" : undefined}
                rel={isExternal ? "noopener noreferrer" : undefined}
                {...rest}
              >
                {children}
              </a>
            );
          },
          // Strip <img> since the source notes reference image paths that
          // aren't bundled with the app.
          img: () => null,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
