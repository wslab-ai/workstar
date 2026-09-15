export {
  Children,
  Component,
  Fragment,
  StrictMode,
  Suspense,
  cloneElement,
  createContext,
  createElement,
  createRef,
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
  useImperativeHandle,
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
