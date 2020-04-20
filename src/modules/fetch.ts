import { effect as T } from "@matechs/effect";
import * as E from "fp-ts/lib/Either";
import { flow } from "fp-ts/lib/function";

export const uri = "@uri/fetch";

export interface Fetch {
  [uri]: {
    fetch: typeof window.fetch;
  }
}

export const fetchLive: Fetch = {
  [uri]: {
    fetch: window.fetch.bind(window)
  },
};

export const provideFetch = T.provide(fetchLive)

class FetchFailed extends Error {
    constructor(info: string) {
      super(`Unable to fetch: ${info}`);
      this.name = "FetchFailed";
    }
  }

const makeFetchFailed = (url: string) => (error: string) => new FetchFailed(
    `Fetching data from `
)

export const fetch = (input: RequestInfo, init?: RequestInit) =>
  T.accessM((_: Fetch) =>
    T.async<FetchFailed, Response>((r) => {
      try {
        _[uri].fetch(input, init).then(response => response.json()).then(flow(E.right, r));
      } catch (error) {
        r(E.left(makeFetchFailed(typeof input === 'string' ? input : input.url)(error)));
      }

      return (cb) => {
        cb(makeFetchFailed(typeof input === 'string' ? input : input.url)(""));
      };
    })
  );
