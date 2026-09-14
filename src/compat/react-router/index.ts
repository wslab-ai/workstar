import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from '../react/hooks.js';
import { createContext, jsx } from '../react/vnode.js';
import { matchRouteTree, Route } from './route-tree.js';

export { Route };

export interface Location {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
  readonly state: unknown;
}

export interface NavigateOptions {
  readonly replace?: boolean;
  readonly state?: unknown;
}

type NavigateFunction = (
  to: string | number,
  options?: NavigateOptions,
) => void;

interface RouterValue {
  readonly location: Location;
  readonly navigate: NavigateFunction;
}

const RouterContext = createContext<RouterValue | null>(null);
const RouteParams = createContext<Readonly<Record<string, string>>>({});
const OutletTarget = createContext<unknown>(null);
const OutletValue = createContext<unknown>(undefined);

function currentLocation(): Location {
  return {
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
    state: window.history.state,
  };
}

function router(): RouterValue {
  const value = useContext(RouterContext);
  if (!value) throw new Error('React Router hooks require BrowserRouter.');
  return value;
}

export function BrowserRouter({ children }: { children?: unknown }): unknown {
  const [location, setLocation] = useState(currentLocation);
  useEffect(() => {
    const onPopState = () => setLocation(currentLocation());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  const navigate = useCallback<NavigateFunction>((to, options) => {
    if (typeof to === 'number') {
      window.history.go(to);
      return;
    }
    const next = new URL(to, window.location.href);
    if (next.origin !== window.location.origin)
      throw new TypeError('Router navigation must stay on the current origin.');
    const method = options?.replace ? 'replaceState' : 'pushState';
    window.history[method](options?.state ?? null, '', next);
    setLocation(currentLocation());
  }, []);
  const value = useMemo(() => ({ location, navigate }), [location, navigate]);
  return jsx(RouterContext.Provider, { value, children });
}

export function useLocation(): Location {
  return router().location;
}

export function useNavigate(): NavigateFunction {
  return router().navigate;
}

export function useParams<
  T extends Record<string, string> = Record<string, string>,
>(): Readonly<Partial<T>> {
  return useContext(RouteParams) as Readonly<Partial<T>>;
}

export function useSearchParams(): [
  URLSearchParams,
  (next: URLSearchParams | string) => void,
] {
  const { location, navigate } = router();
  const set = useCallback(
    (next: URLSearchParams | string) =>
      navigate(`${location.pathname}?${String(next)}`, { replace: true }),
    [location.pathname, navigate],
  );
  return [new URLSearchParams(location.search), set];
}

export function useOutletContext<T>(): T {
  return useContext(OutletValue) as T;
}

export function Outlet({ context }: { context?: unknown }): unknown {
  const content = useContext(OutletTarget);
  return jsx(OutletValue.Provider, { value: context, children: content });
}

export function Routes({ children }: { children?: unknown }): unknown {
  const { location } = router();
  const match = matchRouteTree(children, location.pathname);
  if (!match) return null;
  let content: unknown = null;
  for (const element of [...match.elements].reverse()) {
    content = jsx(OutletTarget.Provider, { value: content, children: element });
  }
  return jsx(RouteParams.Provider, { value: match.params, children: content });
}

export function Navigate({
  to,
  replace,
  state,
}: {
  to: string;
  replace?: boolean;
  state?: unknown;
}): null {
  const navigate = useNavigate();
  useEffect(
    () => navigate(to, { replace: replace === true, state }),
    [navigate, to, replace, state],
  );
  return null;
}

interface LinkProps extends Record<string, unknown> {
  readonly to: string;
  readonly children?: unknown;
  readonly onClick?: (event: MouseEvent) => void;
}

export function Link({ to, onClick, ...props }: LinkProps): unknown {
  const navigate = useNavigate();
  const click = (event: MouseEvent) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey ||
      props.target ||
      props.download
    )
      return;
    event.preventDefault();
    navigate(to);
  };
  return jsx('a', { ...props, href: to, onClick: click });
}

export function NavLink({
  to,
  end = false,
  className,
  ...props
}: LinkProps & {
  readonly end?: boolean;
  readonly className?: string | ((state: { isActive: boolean }) => string);
}): unknown {
  const { pathname } = useLocation();
  const destination = new URL(to, window.location.href).pathname;
  const isActive =
    pathname === destination ||
    (!end && destination !== '/' && pathname.startsWith(`${destination}/`));
  const resolvedClass =
    typeof className === 'function' ? className({ isActive }) : className;
  return jsx(Link, {
    ...props,
    to,
    className: resolvedClass,
    'aria-current': isActive ? 'page' : undefined,
  });
}
