import { effect as T, stream as S } from "@matechs/effect";

import * as O from "fp-ts/lib/Option";
import * as A from "fp-ts/lib/ReadonlyArray";
import * as Eq from "fp-ts/lib/Eq";
import { pipe } from "fp-ts/lib/pipeable";
import {
  constant,
  identity,
  flow,
  constVoid,
  tuple,
  constTrue,
} from "fp-ts/lib/function";

import * as t from "io-ts";
import { Do } from "fp-ts-contrib/lib/Do";

import {
  createElement,
  querySelector,
  makeElementNotFound,
  $,
  parentElement,
  makeParentElementNotFound,
  Dom,
} from "./dom";
import * as Fetch from "./fetch";
import { subscribe, Emitter } from "./emitter";
import { store, Store } from "./store";
import { log, Console } from "@matechs/console";
import { memoize } from "./utils";

/**
 * ```hs
 *
 * URL :: string
 *
 * ```
 *
 * API URL where a list of todo objects is requested from
 */
const URL = "https://jsonplaceholder.typicode.com/todos";

/**
 * ```hs
 *
 * Todo :: t.TypeC<Todo>
 *
 * ```
 *
 * io-ts decoder for Todo
 */
const todoDecoder = t.type(
  {
    id: t.number,
    userId: t.number,
    title: t.string,
    completed: t.boolean,
  },
  "Todo"
);

/**
 * ```hs
 *
 * Todos :: t.TypeC<Todos>
 *
 * ```
 *
 * io-ts decoder for a list of [[Todo]]
 */
const todosDecoder = t.readonlyArray(todoDecoder);

// Types
type Todo = t.TypeOf<typeof todoDecoder>;

type Todos = readonly Todo[];

const eqTodoById = Eq.contramap((todo: Todo) => todo.id)(Eq.eqNumber);

// Store (environment)
const uri = "@uri/todo-store";

interface TodosState {
  todos: Todos;
  filterBy: "all" | "active" | "completed";
}

type TodosStore = Store<TodosState>;

interface TodoStoreEnv {
  [uri]: TodosStore;
}

// Functions
const getFilteredTodos = memoize((filterBy: TodosState["filterBy"]) =>
  memoize((todos: Todos) =>
    filterBy === "all"
      ? todos
      : pipe(
          todos,
          A.filter((todo) =>
            filterBy === "completed" ? todo.completed : !todo.completed
          )
        )
  )
);

const takeTenTodos = memoize<Todos, Todos>(A.takeLeft(10))

/**
 * ```hs
 *
 * todosStore :: Effect unknown never (Store Todos)
 *
 * ```
 *
 * You can update the list of todos by passing a callback function to store.next
 * or subscribe to store changes using the store.subscribe stream.
 */
const storeT = store<TodosState>({
  todos: [],
  filterBy: "all",
});

const provideTodoStore = T.provideM(
  pipe(
    storeT,
    T.map((store) => ({ [uri]: store }))
  )
);

const todoStore = pipe(T.access((_: TodoStoreEnv) => _[uri]));

// APIS
const fetchTodos = pipe(
  // Fetch list of todos from the server
  Fetch.fetch(URL),
  // Decode the response
  T.chain((response) => T.sync(() => todosDecoder.decode(response))),
  // From Effect<R, E, Either<E2, Todos> to Effect<R, E | E2, Todos>
  T.chain(T.fromEither)
);

/**
 * ```hs
 *
 * html :: string
 *
 * ```
 *
 * HTML used to create a todo for
 */
const html = `<li>
    <div class="view">
        <input data-toggle class="toggle" type="checkbox">
        <label data-edit></label>
        <button data-remove class="destroy"></button>
    </div>
    <input class="edit" />
</li>`;

// TODO: Use environment to produce div
const _div = createElement("div");

/**
 * ```hs
 *
 * createDomNodeForTodo :: Effect
 *
 * ```
 *
 * Create a dom element for a todo
 */
const createDomNodeForTodo = pipe(
  _div,
  T.chain((el) =>
    T.sync(() => {
      el.innerHTML = html;
      return querySelector("li")(el);
    })
  ),
  T.chain(
    T.fromOption(
      constant(
        makeElementNotFound("Unable to create DOM element for todo item.")
      )
    )
  )
);

/**
 * ```hs
 *
 * todosUl :: Effect
 *
 * ```
 *
 * Select the ul dom node that contains the list of li nodes that are todo items.
 */
const todosUl = $<HTMLUListElement>(".todo-list");

/**
 * ```hs
 *
 * updateDomNodeOfTodo :: Todo -> HTMLLIElement -> Effect
 *
 * ```
 *
 * Update a given todo dom li node with information from a [[Todo]] model
 */
const updateDomNodeOfTodo = (todo: Todo) => (todoLi: HTMLLIElement) =>
  pipe(
    Do(O.option)
      // Select the input and label dom nodes that are inside the li node
      .bind("label", querySelector("label")(todoLi))
      .bind("checkbox", querySelector("input")(todoLi))
      .bind("input", querySelector<HTMLInputElement>("input.edit")(todoLi))
      .return(({ label, checkbox, input }) =>
        T.sync(() => {
          // Update title
          label.innerHTML = todo.title;

          // Add todo id as attribute
          todoLi.setAttribute("data-todo-id", "" + todo.id);

          // Mark as completed if so
          todo.completed
            ? todoLi.classList.add("completed")
            : todoLi.classList.remove("completed");
          checkbox.checked = todo.completed;
          input.value = todo.title;

          return todoLi;
        })
      ),
    // TODO: Handle if label or input aren't available
    T.fromOption(constant(Error(""))),
    T.chain(identity)
  );

const clickedTodoId = (target: HTMLElement) =>
  pipe(
    parentElement<HTMLElement, HTMLDivElement>(target),
    O.chain((div) => parentElement<HTMLDivElement, HTMLLIElement>(div)),
    T.pure,
    T.chain(T.fromOption(constant(makeParentElementNotFound(target)))),
    T.map((parent) =>
      pipe(
        parent.getAttribute("data-todo-id"),
        O.fromNullable,
        O.map(Number),
        O.map((todoId) => tuple(todoId, parent))
      )
    ),
    T.chain(T.fromOption(constant(makeParentElementNotFound(target))))
  );

/**
 * ```hs
 *
 * handleEvents :: Effect
 *
 * ```
 *
 * Handle click events that indicate the user wants to:
 * - Remove the todo
 * - Toggle the todo's completed status
 * - Edit the todo's title
 *
 */
const handleEvents = pipe(
  // With the root dom node that is the list of items
  todosUl,
  S.encaseEffect,
  // Subscribe to clicking the list
  S.chain(pipe(subscribe("click"))),
  // Map the mouse event to the target (currentTarget would be the list, we want what the user actually clicked.)
  S.map((_) => _.target),
  S.map(O.fromNullable),
  S.chain(S.fromOption),
  S.chain((_) => {
    const target = _ as HTMLElement;

    const todoIdEffect = clickedTodoId(target);

    // Clicking the remove button (red x on hover)
    if (target.hasAttribute("data-remove")) {
      return pipe(
        todoIdEffect,
        T.zip(todoStore),
        T.chain(([[todoId], store]) =>
          store.next((state) => {
            return {
              ...state,
              todos: state.todos.filter((todo) => todo.id !== todoId),
            };
          })
        ),
        S.encaseEffect
      );

      // Clicking the toggle "completed" checkbox
    } else if (target.hasAttribute("data-toggle")) {
      return pipe(
        todoIdEffect,
        T.zip(todoStore),
        T.chain(([[todoId], store]) =>
          store.next((state) => {
            return {
              ...state,
              todos: state.todos.map((todo) =>
                todo.id === todoId
                  ? { ...todo, completed: !todo.completed }
                  : todo
              ),
            };
          })
        ),
        S.encaseEffect
      );

      // Clicking the label to edit the title
    } else if (target.hasAttribute("data-edit")) {
      return pipe(
        todoIdEffect,
        T.chain(([todoId, li]) => {
          // Makes the text input box visible
          const addClass = T.sync(() => {
            li.classList.add("editing");
          });

          // Hides the text input box
          const removeClass = T.sync(() => {
            li.classList.remove("editing");
          });

          const input = pipe(
            li,
            querySelector<HTMLInputElement>("input.edit"),
            T.fromOption(constant(makeElementNotFound("li>input"))),
            T.chain((input) => {
              // Gives the text input box focus and selects the text
              const setFocus = T.sync(() => {
                input.focus();
                input.select();
              });

              // Executes when the text input box looses focus
              // Will hide the text input box
              const handleBlur = pipe(
                input,
                subscribe("blur"),
                S.take(1),
                S.drain,
                T.zip(removeClass)
              );

              // Updates the store on every keystroke
              const handlTextInput = pipe(
                input,
                // Listen to the text input's "oninput" event
                subscribe("input"),
                S.chain(
                  constant(
                    pipe(
                      todoStore,
                      // Update the title of the todo in the store
                      T.chain((store) =>
                        store.next((state) => ({
                          ...state,
                          todos: state.todos.map((todo) =>
                            todo.id === todoId
                              ? { ...todo, title: input.value }
                              : todo
                          ),
                        }))
                      ),
                      S.encaseEffect
                    )
                  )
                ),
                // Do this until the text input box looses focus
                S.takeUntil(handleBlur),
                S.drain
              );

              return pipe(setFocus, T.zip(handlTextInput));
            })
          );

          return pipe(addClass, T.zip(input));
        }),
        S.encaseEffect
      );
    }

    return S.encaseEffect(T.pure(constVoid()));
  }),
  S.drain
);

/**
 * ```hs
 *
 * replaceTodosInStore :: [Todo] => Effect
 *
 * ```
 */
const replaceTodosInStore = (todos: Todos) =>
  pipe(
    todoStore,
    T.chain((store) => store.next((state) => ({ ...state, todos })))
  );

/**
 * ```hs
 *
 * fetchAndStoreTodos :: Effect
 *
 * ```
 *
 * Fetch todo items from the server and replace the store with them.
 */
const fetchAndStoreTodos = pipe(fetchTodos, T.chain(replaceTodosInStore));

const logChanges = T.Do()
  .bind("store", todoStore)
  .bindL("subscription", ({ store }) => store.subscribe)
  .doL(({ subscription }) =>
    pipe(subscription, S.chain(flow(log, S.encaseEffect)), S.drain)
  )
  .return(constVoid);

/**
 * ```hs
 *
 * emptyListOfTodos :: [Todo]
 *
 * ```
 *
 */
const emptyListOfTodos: Todos = [];

/**
 * ```hs
 *
 * getTodosDifference :: [Todo] -> [Todo] -> [Todo]
 *
 * ```
 *
 * Return todos from list a that are not in list b.
 * This is used to remove dom nodes of deleted todos
 *
 */
const getTodosDifference = A.difference(eqTodoById);

/**
 * ```hs
 *
 * removeTodosFromDom :: [Todo] -> Effect
 *
 * ```
 *
 * For each todo, remove it's related dom node if present.
 *
 */
const removeTodosFromDom = (todos: Todos) =>
  pipe(
    todos,
    A.map((todo) =>
      pipe(
        // Find the dom node
        $<HTMLLIElement>(`[data-todo-id="${todo.id}"]`),
        // Remove it from the dom
        T.chain((li) => T.sync(li.remove.bind(li)))
      )
    ),
    A.readonlyArray.sequence(T.effect)
  );

/**
 * ```hs
 *
 * optionOfPreviousTodoInDom :: Effect (Option HTMLLIElement)
 *
 * ```
 *
 * Initial "previous sibling". Used as the initial value when reducing a list of todos
 * into a single effect updating the dom
 *
 */
const optionOfPreviousTodoInDom: T.Effect<
  unknown,
  Console & Dom,
  ReturnType<typeof makeElementNotFound> | Error,
  O.Option<HTMLLIElement>
> = T.pure(O.none);

/**
 * ```hs
 *
 * createAndUpdateTodoNode :: HTMLUListElement -> Effect (Option HTMLLIElement) -> Effect HTMLLIElement
 *
 * ```
 *
 * Creates new dom nodes for todos that are not yet present in the dom
 * and updates dom nodes of other todos
 *
 */
const createAndUpdateTodoNode = (ul: HTMLUListElement) => (
  domNodeOfPreviousTodoInList: O.Option<HTMLLIElement>
) => (todo: Todo) =>
  pipe(
    // Create a dom node
    createDomNodeForTodo,
    // Update it with information from the todo
    T.chain(updateDomNodeOfTodo(todo)),
    // Get the dom node it should attach itself to if available
    // With the new dom node and it's "previous sibling"
    T.chainTap((li) =>
      pipe(
        domNodeOfPreviousTodoInList,
        O.fold(
          // Prepend the dom node to the start of the list if no previous sibling is available
          constant(T.sync(() => ul.prepend(li))),
          // Other wise attach it after it's sibling
          (domNodeOfPreviousTodoInList) =>
            T.sync(() => domNodeOfPreviousTodoInList.after(li))
        )
      )
    )
  );

/**
 * ```hs
 *
 * updateDomWithTodos :: HTMLUListElement -> [Todo] -> Effect
 *
 * ```
 *
 * Creates new dom nodes for todos that are not yet present in the dom
 * and updates dom nodes of other todos
 *
 */
const updateDomWithTodos = (ul: HTMLUListElement) => (todos: Todos) =>
  pipe(
    todos,
    // Reduce the list of todos into a single effect
    A.reduce(optionOfPreviousTodoInDom, (acc, todo) =>
      pipe(
        // Chain over the previous effect
        acc,
        T.chain((optionOfSiblingTodoInDom) =>
          pipe(
            ul,
            querySelector<HTMLLIElement>(`[data-todo-id="${todo.id}"]`),
            O.fold(
              // Create a dom node for new todos
              // The accumulated effect is passed so that
              // new dom nodes can attach themselves after the previous one
              constant(
                createAndUpdateTodoNode(ul)(optionOfSiblingTodoInDom)(todo)
              ),
              // Or if a dom node was found, update it
              updateDomNodeOfTodo(todo)
            ),
            T.map(O.some)
          )
        )
      )
    )
  );

/**
 * ```hs
 *
 * commitStoreUpdatesToDom :: Effect
 *
 * ```
 *
 * Subscribes to store changes and updates the dom.
 *
 */
const commitStoreUpdatesToDom = T.Do()
  .bind("store", todoStore)
  .bindL("subscription", ({ store }) => store.subscribe)
  .bind("ul", todosUl)
  // With store subscription and root dom node do:
  .doL(({ subscription, ul }) =>
    pipe(
      subscription,
      S.map((state) =>
        state.filterBy === "all"
          ? state.todos
          : pipe(
              state.todos,
              A.filter((todo) =>
                state.filterBy === "completed"
                  ? todo.completed
                  : !todo.completed
              )
            )
      ),
      // Take 10 todo items at a time
      S.map(takeTenTodos),
      // Keep track of previous list to use for comparison
      S.scan(tuple(emptyListOfTodos, emptyListOfTodos), ([prev], next) =>
        tuple(next, prev)
      ),
      S.chain(([next, prev]) =>
        S.encaseEffect(
          pipe(
            // Remove todos that were in the previous list but not in the next
            removeTodosFromDom(getTodosDifference(prev, next)),
            // Add todos to the dom that are in the new list but weren't in the previous
            // or update nodes with new information
            T.zip(updateDomWithTodos(ul)(next))
          )
        )
      ),
      S.drain
    )
  )
  .return(constVoid);

const updateCounter = pipe(
  todoStore,
  T.chain((store) => store.subscribe),
  S.encaseEffect,
  S.chain(identity),
  S.map((state) => state.todos),
  S.map((todos) =>
    pipe(
      todos,
      A.filter((todo) => !todo.completed)
    )
  ),
  S.map((todos) => todos.length),
  S.chain((itemsLeft) =>
    S.encaseEffect(
      pipe(
        $(".todo-count"),
        T.map(querySelector("strong")),
        T.chain(
          T.fromOption(constant(makeElementNotFound(".todo-count > strong")))
        ),
        T.chain((el) =>
          T.sync(() => {
            el.innerHTML = "" + itemsLeft;
          })
        )
      )
    )
  ),
  S.drain
);

const makeHandleFilter = (filterBy: "all" | "active" | "completed") =>
  pipe(
    $<HTMLAnchorElement>(`#btn-filter-${filterBy}`),
    S.encaseEffect,
    S.chain(subscribe("click")),
    S.chain(
      constant(
        S.encaseEffect(
          pipe(
            T.parSequenceT(
              $<HTMLAnchorElement>(`#btn-filter-all`),
              $<HTMLAnchorElement>(`#btn-filter-active`),
              $<HTMLAnchorElement>(`#btn-filter-completed`)
            ),
            T.chain((links) =>
              T.sync(() => {
                links.forEach((link) => link.classList.remove("selected"));
              })
            )
          )
        )
      )
    ),
    S.chain(
      constant(
        S.encaseEffect(
          pipe(
            todoStore,
            T.chain((store) => store.next((state) => ({ ...state, filterBy })))
          )
        )
      )
    ),
    S.chain(
      constant(
        S.encaseEffect(
          pipe(
            $<HTMLAnchorElement>(`#btn-filter-${filterBy}`),
            T.chain((link) =>
              T.sync(() => {
                link.classList.add("selected");
              })
            )
          )
        )
      )
    ),
    S.drain
  );

const handleClearCompleted = pipe(
  $<HTMLButtonElement>(`.clear-completed`),
  S.encaseEffect,
  S.chain(subscribe("click")),
  S.chain(
    constant(
      S.encaseEffect(
        pipe(
          todoStore,
          T.chain((store) =>
            store.next((state) => ({
              ...state,
              todos: pipe(
                state.todos,
                A.filter((todo) => !todo.completed)
              ),
            }))
          )
        )
      )
    )
  ),
  S.drain
);

const handleNewTodos = pipe(
  $<HTMLInputElement>(".new-todo"),
  S.encaseEffect,
  S.chain(subscribe("keyup")),
  S.filter((event) => event.key === "Enter"),
  S.map((event) => event.currentTarget as HTMLInputElement | null),
  S.map(O.fromNullable),
  S.chain(S.fromOption),
  S.filter((input) => !!input.value.trim()),
  S.chain((input) =>
    S.encaseEffect(
      pipe(
        todoStore,
        T.chain((store) =>
          store.next((state) => ({
            ...state,
            todos: [
              {
                id: Math.random(),
                title: input.value,
                completed: false,
                userId: Math.random(),
              },
              ...state.todos,
            ],
          }))
        ),
        T.chain(
          constant(
            T.sync(() => {
              input.value = "";
            })
          )
        )
      )
    )
  ),
  S.drain
);

const allTodosAreCompleted = (todos: Todos): boolean =>
  pipe(
    todos,
    A.foldLeft(
      constTrue,
      (todo, rest) => todo.completed && allTodosAreCompleted(rest)
    )
  );

const handleMarkAllAsCompleted = pipe(
  $<HTMLInputElement>("#toggle-all"),
  T.zip(todoStore),
  T.chain(([input, store]) =>
    pipe(
      store.subscribe,
      T.map((susbscription) => tuple(input, store, susbscription))
    )
  ),
  S.encaseEffect,
  S.chain(([input, store, susbscription]) => {
    const stateS: S.AsyncR<Emitter, void> = pipe(
      susbscription,
      S.map((state) => getFilteredTodos(state.filterBy)(state.todos)),
      // Take 10 todo items at a time
      S.map(takeTenTodos),
      S.map((todos) => tuple(allTodosAreCompleted(todos), todos)),
      S.chain(([allCompleted, todos]) =>
        S.encaseEffect(
          T.sync(() => {
            input.checked = allCompleted;
          })
        )
      ),
      S.map(constVoid)
    );

    const clickS = pipe(
      subscribe("click")(input),
      S.chain(
        constant(
          S.encaseEffect(
            pipe(
              store.get,
              T.chain((stateO) =>
                pipe(
                  stateO,
                  O.map((state) => {
                    const todosListed = pipe(
                      getFilteredTodos(state.filterBy)(state.todos),
                      takeTenTodos
                    );

                    const completed = !allTodosAreCompleted(todosListed);

                    return store.next((state) => ({
                      ...state,
                      todos: state.todos.map((todo) =>
                        pipe(
                          todosListed,
                          A.findFirstMap((listedTodo) =>
                            listedTodo.id !== todo.id
                              ? O.none
                              : O.some({ ...todo, completed })
                          ),
                          O.fold(constant(todo), identity)
                        )
                      ),
                    }));
                  }),
                  O.getOrElse<T.Async<void>>(constant(T.sync(constVoid)))
                )
              )
            )
          )
        )
      ),
      S.map(constVoid)
    );

    return S.mergeAll([stateS, clickS]);
  }),
  S.drain
);
/**
 * ```hs
 *
 * main :: Effect
 *
 * ```
 *
 * TodoMVC Program
 */
export const main = pipe(
  T.parSequenceT(
    logChanges,
    fetchAndStoreTodos,
    handleEvents,
    commitStoreUpdatesToDom,
    updateCounter,
    makeHandleFilter("all"),
    makeHandleFilter("active"),
    makeHandleFilter("completed"),
    handleNewTodos,
    handleClearCompleted,
    handleMarkAllAsCompleted
  ),
  provideTodoStore
);
