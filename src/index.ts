import * as serviceWorker from "./serviceWorker";
import "./index.scss";

import { effect as T } from "@matechs/effect";
import { provideConsole } from "@matechs/console";

import { pipe } from "fp-ts/lib/pipeable";

import * as Todo from "./modules/todo";
import { provideDom } from "./modules/dom";
import { provideDocument } from "./modules/document";
import * as Fetch from "./modules/fetch";

import { makeEmitterLive } from "./modules/emitter";


const provided = pipe(
    // Run the main todo program
  Todo.main,
  // Provide DOM utilities
  provideDom,
  // Provide document object
  provideDocument,
  // Provide window.fetch
  Fetch.provideFetch,
  // Provide logging capabilities
  provideConsole,
  // Provide event emitter with root element
  T.provide(makeEmitterLive(document)),
  // Provide depracated thing
  // T.provide({
  //   [T.AsyncRTURI]: {},
  // }),
);

T.runToPromise(provided)
  .then((foo) => console.log("Done", foo))
  .catch((error) => {
    console.error(error);
  });
  
// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
serviceWorker.unregister();
