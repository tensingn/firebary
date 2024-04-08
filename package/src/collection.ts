import {
	CollectionReference,
	DocumentReference,
	DocumentSnapshot,
	FieldPath,
	Filter,
	Firestore,
	Query,
	QueryDocumentSnapshot,
	Settings,
	WriteResult,
} from "@google-cloud/firestore";
import { DatabaseObject } from "./models/database-object.entity.js";
import { DatabaseObjectMultiTypeContainer } from "./models/database-object-multi-type-container.entity.js";
import { Type } from "./interfaces/type.interface.js";
import { QueryOptions } from "./types/query-options.type.js";

export class Collection {
	private readonly db: Firestore;
	private readonly isSingleType: boolean;

	constructor(
		private options: Settings,
		private readonly types: Array<Type>,
		private readonly collectionName: string
	) {
		this.db = new Firestore(this.options);
		this.isSingleType = types.length === 1;
		this.validate();
	}

	private validate() {
		if (this.types.length < 1) {
			throw new Error("No types passed in.");
		}

		if (
			!this.isSingleType &&
			this.types.some((t) => !("type" in new t.prototype.constructor()))
		) {
			throw new Error(
				"Invalid types passed in. For a multi-type container, each type passed in must have a 'type' property."
			);
		}
	}

	// public methods
	async getCollection<T extends DatabaseObject, TField = string>(
		options: QueryOptions<TField>
	): Promise<Array<T>> {
		const docs = await this.getCollectionFromDB<TField>(
			this.collectionName,
			options
		);

		const returnArray = new Array<T>();
		docs.forEach((doc) => {
			const returnObj = doc.data() as T;
			returnObj.id = doc.id;
			returnArray.push(returnObj);
		});
		return returnArray;
	}

	getSingle<T>(id: string): Promise<T> {
		return this.getSingleFromDB<T>(this.collectionName, id);
	}

	async addSingle<T extends DatabaseObject>(
		object: T,
		hasID: boolean = false
	): Promise<T> {
		const { id, ...saveObject } = object;
		let res: DocumentReference | WriteResult;

		if (hasID) {
			if (!id) throw new Error("ID required to add object.");

			const docRef = this.db.collection(this.collectionName).doc(id);

			if ((await docRef.get()).exists)
				throw new Error("Document with this ID already exists.");

			res = await docRef.set(saveObject);
		} else {
			res = await this.db.collection(this.collectionName).add(saveObject);
			object.id = id ? id : (res as DocumentReference).id;
		}

		return object;
	}

	/**
	 * @since 0.0.3
	 *
	 * @param objects objects to write
	 * @returns a void promise
	 *
	 * @description bulk write objects to the collection
	 *
	 * NOTE: only 500 objects can be written at once
	 * NOTE: this is a "fire and forget" method. it does not return objects that were created
	 */
	async addMany<T extends DatabaseObject>(objects: Array<T>): Promise<void> {
		if (objects.length > 500)
			throw new Error("cannot add more than 500 objects at once");

		const writer = this.db.bulkWriter();

		objects.forEach((obj) => {
			const docRef = obj.id
				? this.db.collection(this.collectionName).doc(obj.id)
				: this.db.collection(this.collectionName).doc();
			writer.set(docRef, { ...obj });
		});

		return writer.close();
	}

	async updateSingle(
		id: string,
		partialObject: Object | DatabaseObjectMultiTypeContainer
	): Promise<Object> {
		const saveObject = this.assembleUpdateObject(partialObject);

		await this.db.collection(this.collectionName).doc(id).update(saveObject);

		return saveObject;
	}

	async updateMany(
		partialObjects: Array<{
			id: string;
			data: Object | DatabaseObjectMultiTypeContainer;
		}>
	): Promise<Array<{ id: string; data: Object }>> {
		const saveObjects: Array<{ id: string; data: {} }> = partialObjects.map(
			(po) => {
				return {
					id: po.id,
					data: this.assembleUpdateObject(po.data),
				};
			}
		);

		const batch = this.db.batch();
		const collection = this.db.collection(this.collectionName);

		saveObjects.forEach((o) => {
			const ref = collection.doc(o.id);
			batch.update(ref, o.data);
		});

		await batch.commit();

		return saveObjects.map((o, i) => {
			return {
				id: partialObjects[i].id,
				data: o.data,
			};
		});
	}

	async deleteSingle(id: string) {
		return this.db.collection(this.collectionName).doc(id).delete();
	}

	// private methods
	private async getCollectionFromDB<TField = string>(
		collectionName: string,
		options: QueryOptions<TField> = null
	): Promise<Array<QueryDocumentSnapshot>> {
		const ref = await this.assembleQuery<TField>(collectionName, options);

		return (await ref.get()).docs;
	}

	private async getSingleFromDB<T>(
		collectionName: string,
		id: string
	): Promise<T> {
		const doc = (
			await this.getDocumentSnapshot(collectionName, id)
		).data() as T;
		return doc;
	}

	private async getDocumentSnapshot(
		collectionName: string,
		id: string
	): Promise<DocumentSnapshot> {
		const docRef = this.db.collection(collectionName).doc(id);
		return docRef.get();
	}

	private async assembleQuery<TField = string>(
		collectionName: string,
		options: QueryOptions<TField>
	): Promise<CollectionReference | Query> {
		if (options?.whereOptions && options.orderOptions) {
			throw new Error(
				"Can't use WhereOptions and OrderOptions in the same query."
			);
		}

		let ref: CollectionReference | Query = this.db.collection(collectionName);

		if (options?.whereOptions) {
			const whereOptions = options.whereOptions;
			const whereClauses = whereOptions.whereClauses;
			const pagingOptions = whereOptions.pagingOptions;

			if (!pagingOptions) throw new Error("PagingOptions are required.");

			const last = pagingOptions.startAfter
				? await this.getDocumentSnapshot(
						collectionName,
						pagingOptions.startAfter
				  )
				: null;

			if (whereOptions.operator == "or") {
				const orWhereClauses: Array<Filter> = whereClauses.map((wc) => {
					return Filter.where(wc.field, wc.operation, wc.value);
				});
				ref = ref.where(Filter.or(...orWhereClauses));
			} else {
				whereClauses.forEach((wc) => {
					ref = ref.where(wc.field, wc.operation, wc.value);
				});
			}

			if (last) {
				ref = ref.startAfter(last);
			}

			ref = ref.limit(pagingOptions.limit);
		} else if (options?.orderOptions) {
			const orderOptions = options.orderOptions;
			const pagingOptions = orderOptions.pagingOptions;

			if (!pagingOptions) {
				throw new Error("PagingOptions are required.");
			}

			ref = ref.orderBy(orderOptions.field, orderOptions.direction);

			if (pagingOptions.startAfter) {
				ref = ref.startAfter(pagingOptions.startAfter);
			}

			ref = ref.limit(pagingOptions.limit);
		} else if (options.pagingOptions) {
			const pagingOptions = options.pagingOptions;
			ref = ref.orderBy(FieldPath.documentId());

			if (pagingOptions.startAfter) {
				ref = ref.startAfter(pagingOptions.startAfter);
			}

			ref = ref.limit(pagingOptions.limit);
		} else {
			ref = ref.orderBy(FieldPath.documentId(), "asc").limit(10);
		}

		return ref;
	}

	private assembleUpdateObject(
		partialObject: Object | DatabaseObjectMultiTypeContainer
	): {} {
		const partialObjectProps = Object.getOwnPropertyNames(partialObject);

		let updateType: Type;
		if (this.isSingleType) {
			updateType = this.types[0];
		} else {
			updateType = this.types.find(
				(t) =>
					"type" in partialObject &&
					t.name.toLocaleLowerCase() === partialObject.type
			);
		}

		if (!updateType)
			throw new Error("Could not derive updateType from partialObject.");

		const saveObjectProps = Object.getOwnPropertyNames(
			new updateType.prototype.constructor()
		);

		const saveObject = {};
		partialObjectProps.forEach((prop) => {
			if (
				prop !== "type" &&
				saveObjectProps.includes(prop) &&
				prop in partialObject
			) {
				saveObject[prop] = partialObject[prop];
			}
		});

		return saveObject;
	}
}
