import { DatabaseObject } from "./database-object.entity.js";

export class DatabaseObjectMultiTypeContainer extends DatabaseObject {
	constructor(public type: string) {
		super();
	}
}
