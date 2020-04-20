import { effect as T, stream as S, managed as M } from "@matechs/effect";
import { pipe } from "fp-ts/lib/pipeable";
import { log } from "@matechs/console";

export const uri = "@uri/emitter";

export type EventFor<TEventType extends string> = TEventType extends
  | "keypress"
  | "keyup"
  | "keydown"
  ? KeyboardEvent
  : TEventType extends "click" | "dblclick" | "mousemove" | "mousedown" | "mouseup"
  ? MouseEvent
  : Event;

export type EventHandler<TEventType extends string> = (
  evt: EventFor<TEventType>
) => void;

export interface Emitter {
  [uri]: {
    fromEvent: <TEventType extends string>(
      type: TEventType
    ) => (cb: EventHandler<TEventType>) => T.Effect<unknown, unknown, never, void>;
    addEventListener: <TElement extends Pick<Element, 'addEventListener' | 'removeEventListener'>>(
      el: TElement
    ) => <TEventType extends string>(
      type: TEventType
    ) => (cb: EventHandler<TEventType>) => T.Effect<unknown, unknown, never, void>;
  };
}

// Events
export const subscribe = <TEventType extends string>(type: TEventType, ret?: any) => <
  TElement extends  Pick<Element, 'addEventListener' | 'removeEventListener'>
>(
  el?: TElement
) => {
  return S.fromSource(
    M.managed.chain(
      M.bracket(
        T.accessM((_: Emitter) =>
          T.sync(() => {
            const { next, ops, hasCB } = S.su.queueUtils<
              never,
              EventFor<TEventType>
            >();

            const fn = el ? _[uri].addEventListener(el) : _[uri].fromEvent;

            return {
              unsubscribe: fn(type)(a => {
                next({ _tag: "offer", a })
                return ret
              }),
              ops,
              hasCB
            };
          })
        ),
        _ => _.unsubscribe
      ),
      ({ ops, hasCB }) => S.su.emitter(ops, hasCB)
    )
  );
};

export const makeEmitterLive = <
  TRoot extends Pick<Element, "addEventListener" | "removeEventListener">
>(
  rootEl: TRoot
): Emitter => {
  return {
    [uri]: {
      fromEvent: <TEventType extends string>(type: TEventType) => (
        cb: EventHandler<TEventType>
      ) => {
        const wrappedCb = (e: EventFor<TEventType>) => {
          e.stopPropagation();
          return cb(e);
        };
        rootEl.addEventListener(type, wrappedCb as any);

        return T.sync(() => rootEl.removeEventListener(type, cb as any));
      },
      addEventListener: <TElement extends Pick<Element, 'addEventListener' | 'removeEventListener'>>(el: TElement) => <
        TEventType extends string
      >(
        type: TEventType
      ) => (cb: EventHandler<TEventType>) => {
        const wrappedCb = (e: EventFor<TEventType>) => {
          e.stopPropagation();
          return cb(e);
        };
        el.addEventListener(type, wrappedCb as any);

        return T.sync(() => el.removeEventListener(type, cb as any));
      }
    }
  };
};

/**
 * waitForKeyPress :: number -> Effect NoEnv never void
 *
 * Given a keyCode returns an effect that resolves once the user
 * presses a key on the keyboard matching the key code.
 */
export const waitForKeyPress = (...keyCodes: number[]) =>
  T.effect.chain(log("Waiting for ", ...keyCodes), () =>
    pipe(
      subscribe("keyup")(),
      S.filter(event => keyCodes.includes(event.keyCode)),
      S.take(1),
      S.collectArray,
      T.map(([evt]) => evt)
    )
  );
