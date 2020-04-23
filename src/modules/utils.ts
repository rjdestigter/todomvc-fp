export const memoize = <A, B>(f: (arg: A) => B) => {
    let previousA: A | undefined = undefined;
    let previousB: B;

    return (a: A) => {
        if (previousA == null)
            previousA = a;

        if(a !== previousA || previousB == null) {
            previousA = a
            previousB = f(previousA)
        }

        return previousB 
    }
}