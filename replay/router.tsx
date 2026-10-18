/* Hash router standing in for next/link and next/navigation in the hosted demo,
 * so the same pages work inside a single self-contained HTML file. */
import { useEffect, useState, type AnchorHTMLAttributes } from "react";

const current = () => {
  const h = window.location.hash.replace(/^#/, "") || "/";
  const [path, query = ""] = h.split("?");
  return { path, query };
};

export function useLocation() {
  const [loc, setLoc] = useState(current);
  useEffect(() => {
    const on = () => setLoc(current());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return loc;
}

export function useSearchParams() {
  return new URLSearchParams(useLocation().query);
}

const go = (href: string) => {
  window.location.hash = href;
  window.scrollTo(0, 0);
};

export function useRouter() {
  return { push: go, replace: go, back: () => history.back() };
}

export function usePathname() {
  return useLocation().path;
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean };
export default function Link({ href, prefetch: _p, onClick, ...rest }: LinkProps) {
  void _p;
  return (
    <a
      {...rest}
      href={`#${href}`}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        go(href);
      }}
    />
  );
}
