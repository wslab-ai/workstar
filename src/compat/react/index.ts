export {
  Children,
  Fragment,
  StrictMode,
  Suspense,
  cloneElement,
  createContext,
  createElement,
  forwardRef,
  isValidElement,
  lazy,
  memo,
} from './vnode.js';
export {
  useCallback,
  useContext,
  useDebugValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from './hooks.js';
import * as ReactCompat from './vnode.js';
import * as ReactHooks from './hooks.js';

export default { ...ReactCompat, ...ReactHooks };
