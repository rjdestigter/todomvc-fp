import { effect as T, stream as S } from "@matechs/effect";
import * as O from "fp-ts/lib/Option";
import { pipe } from "fp-ts/lib/pipeable";
import { constant, flow, identity } from "fp-ts/lib/function";
import { subscribe, Emitter, EventFor } from "./emitter";
import { DocumentEnv, getDocument } from "./document";

/**
 * Environment
 */
export const uri = "@uri/dom";

export interface Dom {
  [uri]: {
    createElement<K extends keyof HTMLElementTagNameMap>(
      tagName: K,
      options?: ElementCreationOptions
    ): HTMLElementTagNameMap[K];
    createElement(
      tagName: string,
      options?: ElementCreationOptions
    ): HTMLElement;
  };
}

export const domLive: Dom = {
  [uri]: {
    createElement: (tagName: any, options?: ElementCreationOptions) =>
      document.createElement(tagName, options),
  },
};

export const provideDom = T.provide(domLive);

/**
 * Errors
 */
class ElementNotFound extends Error {
  constructor(selectors: string) {
    super(`$(${selectors}) did not return an element.`);
    this.name = "ElementNotFound";
  }
}

class ParentElementNotFound extends Error {
  constructor(child: string) {
    super(`Parent of node: ${child} not found.`);
    this.name = "ParentElementNotFound";
  }
}

export const makeElementNotFound = (selectors: string) =>
  new ElementNotFound(selectors);

export const raiseElementNotFound = flow(makeElementNotFound, T.raiseError);

export const makeParentElementNotFound = (element: HTMLElement) =>
  new ParentElementNotFound(element.toString());

export const raiseParentElementNotFound = flow(
  makeParentElementNotFound,
  T.raiseError
);

/**
 * Utilities
 */
interface CreateElement {
  <K extends keyof HTMLElementTagNameMap>(
    tagName: K,
    options?: ElementCreationOptions
  ): T.Effect<unknown, Dom, never, HTMLElementTagNameMap[K]>;
  (tagName: string, options?: ElementCreationOptions): T.Effect<
    unknown,
    Dom,
    never,
    HTMLElement
  >;
}

export const createElement: CreateElement = (
  tagName: string,
  options?: ElementCreationOptions
) => T.accessM((_: Dom) => T.pure(_[uri].createElement(tagName, options)));

/**
 * QuerySelector
 */
interface QuerySelector {
  <K extends keyof HTMLElementTagNameMap>(selectors: K): <
    TNode extends ParentNode
  >(
    node: TNode
  ) => O.Option<HTMLElementTagNameMap[K]>;
  <K extends keyof SVGElementTagNameMap>(selectors: K): <
    TNode extends ParentNode
  >(
    node: TNode
  ) => O.Option<SVGElementTagNameMap[K]>;
  <E extends Element = Element>(selectors: string): <TNode extends ParentNode>(
    node: TNode
  ) => O.Option<E>;
}

interface QuerySelectorT {
  <K extends keyof HTMLElementTagNameMap>(selectors: K): <
    TNode extends ParentNode
  >(
    node: O.Option<TNode>
  ) => O.Option<HTMLElementTagNameMap[K]>;
  <K extends keyof SVGElementTagNameMap>(selectors: K): <
    TNode extends ParentNode
  >(
    node: O.Option<TNode>
  ) => O.Option<SVGElementTagNameMap[K]>;
  <E extends Element = Element>(selectors: string): <TNode extends ParentNode>(
    node: O.Option<TNode>
  ) => O.Option<E>;
}

export const querySelector: QuerySelector = (selectors: string) => <
  TNode extends ParentNode
>(
  el: TNode
) => O.fromNullable(el.querySelector(selectors));

export const querySelectorO: QuerySelectorT = (selectors: string) => <
  TNode extends ParentNode
>(
  nodeOT: O.Option<TNode>
) =>
  pipe(
    nodeOT,
    O.map((el) => querySelector(selectors)(el))
  );

/**
 * $
 */
interface $ {
  <K extends keyof HTMLElementTagNameMap>(selectors: K): T.Effect<
    unknown,
    DocumentEnv,
    ElementNotFound,
    HTMLElementTagNameMap[K]
  >;
  <K extends keyof SVGElementTagNameMap>(selectors: K): T.Effect<
    unknown,
    DocumentEnv,
    ElementNotFound,
    SVGElementTagNameMap[K]
  >;
  <E extends Element = Element>(selectors: string): T.Effect<
    unknown,
    DocumentEnv,
    ElementNotFound,
    E
  >;
}

export const $: $ = (selectors: string) =>
  pipe(
    getDocument,
    T.map(querySelector(selectors)),
    T.chain(T.fromOption(constant(makeElementNotFound(selectors))))
  );

/**
 * ```hs
 * parentElement :: Node -> Option<HTMLelement>
 * ```
 */
export const parentElement = <TNode extends Node, TParentNode extends Node>(
  node: TNode
) => O.fromNullable(node.parentElement as TParentNode | null);

export class EmptyOptionOfElement extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmptyOptionOfElement";
  }
}

export const raiseEmptyOptionOfElement = (message: string) =>
  T.raiseError(new EmptyOptionOfElement(message));

export const makeEventStream = <TEventType extends string>(
  eventType: TEventType
) => <
  R,
  E,
  A extends Pick<Element, "addEventListener" | "removeEventListener">
>(
  elementT: T.Effect<unknown, R, E, O.Option<A>>
) =>
  pipe(
    elementT,
    T.map((elementO) =>
      pipe(
        elementO,
        O.map(subscribe(eventType)),
        (effect) => effect,
        O.fold<
          S.Stream<unknown, Emitter, never, EventFor<TEventType>>,
          S.Stream<unknown, Emitter, EmptyOptionOfElement, EventFor<TEventType>>
        >(
          constant(
            S.raised(
              new EmptyOptionOfElement(
                `Option does not contain some element to create ${eventType} event stream for`
              )
            )
          ),
          identity
        )
      )
    )
  );

export const makeClickStream = makeEventStream("click");
