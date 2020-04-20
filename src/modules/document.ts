import { effect as T } from "@matechs/effect";
import { pipe } from "fp-ts/lib/pipeable";
import {  flow } from "fp-ts/lib/function";

export const documentUri = "@uri/document";

export type DocumentEnv = { [documentUri]: Document };

export const documentLive = {
  [documentUri]: document,
};

export const provideDocument = T.provide(documentLive);

export const getDocument = T.accessM(
  flow((_: DocumentEnv) => _[documentUri], T.pure)
);

export const mapDocument = <R, E, A>(f: (doc: Document) => T.Effect<unknown, R, E, A>) =>
  pipe(getDocument, T.map(f));
