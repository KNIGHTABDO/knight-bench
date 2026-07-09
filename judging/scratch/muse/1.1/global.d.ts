
declare namespace JSX { interface IntrinsicAttributes { key?: any; } interface IntrinsicElements { [elemName: string]: any; } }
declare namespace React { type ReactNode = any; type CSSProperties = any; type Ref<T = any> = any; type RefObject<T = any> = any; type MutableRefObject<T = any> = any; type FC<P = any> = (props: P) => any; }
declare namespace NodeJS { type Timeout = any; }
declare const process: any;
declare module "react" {
  export function useState<T = any>(initial?: T | (() => T)): [T, any];
  export function useEffect(effect: any, deps?: any[]): any;
  export function useMemo<T = any>(factory: () => T, deps?: any[]): T;
  export function useRef<T = any>(initial?: T): any;
  export function useCallback<T = any>(cb: T, deps?: any[]): T;
  export function forwardRef<T = any, P = any>(render: any): any;
  export type RefObject<T = any> = any;
  export type MutableRefObject<T = any> = any;
  export type ReactNode = any;
  export type CSSProperties = any;
  export const Fragment: any;
  const React: any; export default React;
}
declare module "react/jsx-runtime" { export const jsx: any; export const jsxs: any; export const Fragment: any; }
declare module "next/link" { const Link: any; export default Link; }
declare module "next/image" { const Image: any; export default Image; }
declare module "next/navigation" { export function useParams<T = any>(): T; export const useRouter: any; export const useSearchParams: any; }
declare module "better-sqlite3" { const Database: any; export default Database; }
declare module "path" { const path: any; export default path; export const join: any; export const resolve: any; }
declare module "hls.js" { const Hls: any; export default Hls; export const Events: any; export const ErrorTypes: any; export const ErrorDetails: any; }
declare module "*.css" { const v: any; export default v; }


