export declare class JsonLStream<Event> {
    private readonly stream;
    private readonly decoder;
    constructor(init: {
        stream: ReadableStream<Uint8Array>;
        decoder: (rawEvent: string) => Event;
    });
    [Symbol.asyncIterator](): AsyncGenerator<Event, void, unknown>;
}
//# sourceMappingURL=jsonl.d.ts.map