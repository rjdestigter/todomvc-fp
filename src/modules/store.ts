import {
  effect as T,
  ref,
  stream as S,
  queue as Q,
  managed as M,
} from "@matechs/effect";
import { pipe } from "fp-ts/lib/pipeable";
import { some } from "fp-ts/lib/Option";

export type Store<A> = {
    next: (f: (current: A) => A) => T.Effect<T.AsyncRT, never, void>,
    subscribe: S.Stream<T.AsyncRT, never, A>
}

export const store = <A>(initial?: A) =>
  pipe(
    Q.unboundedQueue<A>(),
    T.zip(ref.makeRef(initial ? [initial] : [])),
    T.map(([queue, state]): Store<A> => {
      const next = (f: (current: A) => A) =>
        pipe(
            state.update(([current]) => [f(current)]),
            T.chain(([a]) => queue.offer(a))
        );

      const subscribe = pipe(
        S.fromSource(M.pure(pipe(queue.take, T.map(some))))
      );
      return { next, subscribe }
    })
  );
