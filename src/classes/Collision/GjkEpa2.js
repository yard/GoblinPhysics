/**
 * Provides the classes and algorithms for running GJK+EPA based collision detection
 *
 * @class GjkEpa2
 * @static
 */
Goblin.GjkEpa2 = {
    max_iterations: 20,
    epa_condition: 0.001,

    /**
     * Holds a point on the edge of a Minkowski difference along with that point's witnesses and the direction used to find the point
     *
     * @class SupportPoint
     * @param witness_a {vec3} Point in first object used to find the supporting point
     * @param witness_b {vec3} Point in the second object ued to find th supporting point
     * @param point {vec3} The support point on the edge of the Minkowski difference
     * @constructor
     */
    SupportPoint: function( witness_a, witness_b, point ) {
        this.witness_a = witness_a;
        this.witness_b = witness_b;
        this.point = point;
    },

    /**
     * Finds the extant point on the edge of the Minkowski difference for `object_a` - `object_b` in `direction`
     *
     * @method findSupportPoint
     * @param object_a {Goblin.RigidBody} First object in the search
     * @param object_b {Goblin.RigidBody} Second object in the search
     * @param direction {vec3} Direction to find the extant point in
     * @param gjk_point {Goblin.GjkEpa.SupportPoint} `SupportPoint` class to store the resulting point & witnesses in
     */
    findSupportPoint: (function(){
        var temp = vec3.create();
        return function( object_a, object_b, direction, support_point ) {
            // Find witnesses from the objects
            object_a.findSupportPoint( direction, support_point.witness_a );
            vec3.negate( direction, temp );
            object_b.findSupportPoint( temp, support_point.witness_b );

            // Find the CSO support point
            vec3.subtract( support_point.witness_a, support_point.witness_b, support_point.point );
        };
    })(),

    /**
     * Perform GJK algorithm against two objects. Returns a ContactDetails object if there is a collision, else null
     *
     * @method GJK
     * @param object_a {Goblin.RigidBody}
     * @param object_b {Goblin.RigidBody}
     * @return {Goblin.ContactDetails|Boolean} Returns `null` if no collision, else a `ContactDetails` object
     */
	GJK: (function(){
        return function( object_a, object_b ) {
            var simplex = new Goblin.GjkEpa2.Simplex( object_a, object_b ),
                last_point;

            while ( ( last_point = simplex.addPoint() ) ){}

            // If last_point is false then there is no collision
            if ( last_point === false ) {
				Goblin.GjkEpa2.freeSimplex( simplex );
                return null;
            }

            return simplex;
        };
    })(),

	freeSimplex: function( simplex ) {
		// Free the support points used by this simplex
		for ( var i = 0, points_length = simplex.points.length; i < points_length; i++ ) {
			Goblin.ObjectPool.freeObject( 'GJK2SupportPoint', simplex.points[i] );
		}
	},

	freePolyhedron: function( polyhedron ) {
		// Free the support points used by the polyhedron (includes the points from the simplex used to create the polyhedron
		var pool = Goblin.ObjectPool.pools['GJK2SupportPoint'];

		for ( var i = 0, faces_length = polyhedron.faces.length; i < faces_length; i++ ) {
			// The indexOf checking is required because vertices are shared between faces
			if ( pool.indexOf( polyhedron.faces[i].a ) === -1 ) {
				Goblin.ObjectPool.freeObject( 'GJK2SupportPoint', polyhedron.faces[i].a );
			}
			if ( pool.indexOf( polyhedron.faces[i].b ) === -1 ) {
				Goblin.ObjectPool.freeObject( 'GJK2SupportPoint', polyhedron.faces[i].b );
			}
			if ( pool.indexOf( polyhedron.faces[i].c ) === -1 ) {
				Goblin.ObjectPool.freeObject( 'GJK2SupportPoint', polyhedron.faces[i].c );
			}
		}
	},

    /**
     * Performs the Expanding Polytope Algorithm a GJK simplex
     *
     * @method EPA
     * @param simplex {Goblin.GjkEpa2.Simplex} Simplex generated by the GJK algorithm
     * @return {Goblin.ContactDetails}
     */
    EPA: (function(){
		return function( simplex ) {
            // Time to convert the simplex to real faces
            // @TODO this should be a priority queue where the position in the queue is ordered by distance from face to origin
			var polyhedron = new Goblin.GjkEpa2.Polyhedron( simplex );

			var i = 0;

            // Expand the polyhedron until it doesn't expand any more
			while ( ++i ) {
				polyhedron.findFaceClosestToOrigin();

				// Find a new support point in the direction of the closest point
				if ( polyhedron.closest_face_distance < Goblin.EPSILON ) {
					vec3.set( polyhedron.faces[polyhedron.closest_face].normal, _tmp_vec3_1 );
				} else {
					vec3.set( polyhedron.closest_point, _tmp_vec3_1 );
				}

				var support_point = Goblin.ObjectPool.getObject( 'GJK2SupportPoint' );
				Goblin.GjkEpa2.findSupportPoint( simplex.object_a, simplex.object_b, _tmp_vec3_1, support_point );

				// Check for terminating condition
                vec3.subtract( support_point.point, polyhedron.closest_point, _tmp_vec3_1 );
                var gap = vec3.squaredLength( _tmp_vec3_1 );

				if ( i === Goblin.GjkEpa2.max_iterations || ( gap < Goblin.GjkEpa2.epa_condition && polyhedron.closest_face_distance > Goblin.EPSILON ) ) {

					// Get a ContactDetails object and fill out its details
					var contact = Goblin.ObjectPool.getObject( 'ContactDetails' );
					contact.object_a = simplex.object_a;
					contact.object_b = simplex.object_b;

					vec3.normalize( polyhedron.closest_point, contact.contact_normal );
					if ( vec3.squaredLength( contact.contact_normal ) === 0 ) {
						vec3.subtract( contact.object_b.position, contact.object_a.position, contact.contact_normal );
					}
					vec3.normalize( contact.contact_normal );

					var barycentric = vec3.create();
					Goblin.GeometryMethods.findBarycentricCoordinates( polyhedron.closest_point, polyhedron.faces[polyhedron.closest_face].a.point, polyhedron.faces[polyhedron.closest_face].b.point, polyhedron.faces[polyhedron.closest_face].c.point, barycentric );

					if ( isNaN( barycentric[0] ) ) {
                        // @TODO: Avoid this degenerate case
						//console.log( 'Point not in triangle' );
						Goblin.GjkEpa2.freePolyhedron( polyhedron );
						return null;
					}

					var confirm = {
						a: vec3.create(),
						b: vec3.create(),
						c: vec3.create()
					};

					// Contact coordinates of object a
					vec3.scale( polyhedron.faces[polyhedron.closest_face].a.witness_a, barycentric[0], confirm.a );
					vec3.scale( polyhedron.faces[polyhedron.closest_face].b.witness_a, barycentric[1], confirm.b );
					vec3.scale( polyhedron.faces[polyhedron.closest_face].c.witness_a, barycentric[2], confirm.c );
					vec3.add( confirm.a, confirm.b, contact.contact_point_in_a );
					vec3.add( contact.contact_point_in_a, confirm.c );

					// Contact coordinates of object b
					vec3.scale( polyhedron.faces[polyhedron.closest_face].a.witness_b, barycentric[0], confirm.a );
					vec3.scale( polyhedron.faces[polyhedron.closest_face].b.witness_b, barycentric[1], confirm.b );
					vec3.scale( polyhedron.faces[polyhedron.closest_face].c.witness_b, barycentric[2], confirm.c );
					vec3.add( confirm.a, confirm.b, contact.contact_point_in_b );
					vec3.add( contact.contact_point_in_b, confirm.c );

					// Find actual contact point
					vec3.add( contact.contact_point_in_a, contact.contact_point_in_b, contact.contact_point );
					vec3.scale( contact.contact_point, 0.5 );

					// Set objects' local points
					mat4.multiplyVec3( contact.object_a.transform_inverse, contact.contact_point_in_a );
					mat4.multiplyVec3( contact.object_b.transform_inverse, contact.contact_point_in_b );

					// Calculate penetration depth
					contact.penetration_depth = vec3.length( polyhedron.closest_point );

					contact.restitution = ( simplex.object_a.restitution + simplex.object_b.restitution ) / 2;
					contact.friction = ( simplex.object_a.friction + simplex.object_b.friction ) / 2;

					Goblin.GjkEpa2.freePolyhedron( polyhedron );

					return contact;
				}

                polyhedron.addVertex( support_point );
			}

			Goblin.GjkEpa2.freePolyhedron( polyhedron );
            return null;
        };
    })(),

    Face: function( polyhedron, a, b, c ) {
		this.active = true;
		//this.polyhedron = polyhedron;
        this.a = a;
        this.b = b;
        this.c = c;
        this.normal = vec3.create();
		this.neighbors = [];

        vec3.subtract( b.point, a.point, _tmp_vec3_1 );
        vec3.subtract( c.point, a.point, _tmp_vec3_2 );
        vec3.cross( _tmp_vec3_1, _tmp_vec3_2, this.normal );
        vec3.normalize( this.normal );
    }
};

Goblin.GjkEpa2.Polyhedron = function( simplex ) {
	this.closest_face = null;
	this.closest_face_distance = null;
	this.closest_point = vec3.create();

	this.faces = [
		//BCD, ACB, CAD, DAB
		new Goblin.GjkEpa2.Face( this, simplex.points[2], simplex.points[1], simplex.points[0] ),
		new Goblin.GjkEpa2.Face( this, simplex.points[3], simplex.points[1], simplex.points[2] ),
		new Goblin.GjkEpa2.Face( this, simplex.points[1], simplex.points[3], simplex.points[0] ),
		new Goblin.GjkEpa2.Face( this, simplex.points[0], simplex.points[3], simplex.points[2] )

		/*new Goblin.GjkEpa2.Face( this, simplex.points[0], simplex.points[2], simplex.points[3] ), // ACD
		new Goblin.GjkEpa2.Face( this, simplex.points[0], simplex.points[1], simplex.points[2] ), // ABC
		new Goblin.GjkEpa2.Face( this, simplex.points[0], simplex.points[3], simplex.points[1] ), // ADB
		new Goblin.GjkEpa2.Face( this, simplex.points[3], simplex.points[2], simplex.points[1] ) // DCB*/
	];

	this.faces[0].neighbors.push( this.faces[1], this.faces[2], this.faces[3] );
	this.faces[1].neighbors.push( this.faces[2], this.faces[0], this.faces[3] );
	this.faces[2].neighbors.push( this.faces[1], this.faces[3], this.faces[0] );
	this.faces[3].neighbors.push( this.faces[2], this.faces[1], this.faces[0] );
};
Goblin.GjkEpa2.Polyhedron.prototype = {
    addVertex: function( vertex )
    {
        var edges = [], faces = [], i, j, a, b, last_b;
		if ( !this.faces[this.closest_face] ) debugger;
        this.faces[this.closest_face].silhouette( vertex, edges );

        // Re-order the edges if needed
        for ( i = 0; i < edges.length - 5; i += 5 ) {
            a = edges[i+3];
            b = edges[i+4];

            // Ensure this edge really should be the next one
            if ( i !== 0 && last_b !== a ) {
                // It shouldn't
                for ( j = i + 5; j < edges.length; j += 5 ) {
                    if ( edges[j+3] === last_b ) {
                        // Found it
                        var tmp = edges.slice( i, i + 5 );
                        edges[i] = edges[j];
                        edges[i+1] = edges[j+1];
                        edges[i+2] = edges[j+2];
                        edges[i+3] = edges[j+3];
                        edges[i+4] = edges[j+4];
                        edges[j] = tmp[0];
                        edges[j+1] = tmp[1];
                        edges[j+2] = tmp[2];
                        edges[j+3] = tmp[3];
                        edges[j+4] = tmp[4];

                        a = edges[i+3];
                        b = edges[i+4];
                        break;
                    }
                }
            }
            last_b = b;
        }

        for ( i = 0; i < edges.length; i += 5 ) {
            var neighbor = edges[i];
            a = edges[i+3];
            b = edges[i+4];

            var face = new Goblin.GjkEpa2.Face( this, b, vertex, a );
            face.neighbors[2] = edges[i];
            faces.push( face );

            neighbor.neighbors[neighbor.neighbors.indexOf( edges[i+2] )] = face;
        }

        for ( i = 0; i < faces.length; i++ ) {
            faces[i].neighbors[0] = faces[ i + 1 === faces.length ? 0 : i + 1 ];
            faces[i].neighbors[1] = faces[ i - 1 < 0 ? faces.length - 1 : i - 1 ];
        }

		Array.prototype.push.apply( this.faces, faces );

        return edges;
    },

	findFaceClosestToOrigin: (function(){
		var origin = vec3.create(),
			point = vec3.create();

		return function() {
			this.closest_face_distance = Infinity;

			var distance, i;

			for ( i = 0; i < this.faces.length; i++ ) {
				if ( this.faces[i].active === false ) {
					continue;
				}

				Goblin.GeometryMethods.findClosestPointInTriangle( origin, this.faces[i].a.point, this.faces[i].b.point, this.faces[i].c.point, point );
				distance = vec3.squaredLength( point );
				if ( distance < this.closest_face_distance ) {
					this.closest_face_distance = distance;
					this.closest_face = i;
					vec3.set( point, this.closest_point );
				}
			}
		};
	})()
};

Goblin.GjkEpa2.Face.prototype = {
	/**
	 * Determines if a vertex is in front of or behind the face
	 *
	 * @method classifyVertex
	 * @param vertex {vec3} Vertex to classify
	 * @return {Number} If greater than 0 then `vertex' is in front of the face
	 */
	classifyVertex: function( vertex ) {
		var w = vec3.dot( this.normal, this.a.point ),
			x = vec3.dot( this.normal, vertex.point ) - w;
		return x;
	},

	silhouette: function( point, edges, source ) {
        if ( this.active === false ) {
            return;
        }

        if ( this.classifyVertex( point ) > 0 ) {
			// This face is visible from `point`. Deactivate this face and alert the neighbors
			this.active = false;

			this.neighbors[0].silhouette( point, edges, this );
			this.neighbors[1].silhouette( point, edges, this );
            this.neighbors[2].silhouette( point, edges, this );
		} else if ( source ) {
			// This face is a neighbor to a now-silhouetted face, determine which neighbor and replace it
			var neighbor_idx = this.neighbors.indexOf( source ),
                a, b;
            if ( neighbor_idx === 0 ) {
                a = this.a;
                b = this.b;
            } else if ( neighbor_idx === 1 ) {
                a = this.b;
                b = this.c;
            } else {
                a = this.c;
                b = this.a;
            }
			edges.push( this, neighbor_idx, source, b, a );
		}
	}
};

(function(){
    var ao = vec3.create(),
        ab = vec3.create(),
        ac = vec3.create(),
        ad = vec3.create();

    Goblin.GjkEpa2.Simplex = function( object_a, object_b ) {
        this.object_a = object_a;
        this.object_b = object_b;
        this.points = [];
        this.iterations = 0;
        this.next_direction = vec3.create();
        this.updateDirection();
    };
    Goblin.GjkEpa2.Simplex.prototype = {
        addPoint: function() {
            if ( ++this.iterations === Goblin.GjkEpa2.max_iterations ) {
                return false;
            }

            var support_point = Goblin.ObjectPool.getObject( 'GJK2SupportPoint' );
            Goblin.GjkEpa2.findSupportPoint( this.object_a, this.object_b, this.next_direction, support_point );
            this.points.push( support_point );

            if ( vec3.dot( this.points[this.points.length-1].point, this.next_direction ) < 0 ) {
                // if the last added point was not past the origin in the direction
                // then the Minkowski difference cannot contain the origin because
                // point added is past the edge of the Minkowski difference
                return false;
            }

            if ( this.updateDirection() === true ) {
                // Found a collision
                return null;
            }

            return support_point;
        },

        findDirectionFromLine: function() {
            vec3.negate( this.points[1].point, ao );
            vec3.subtract( this.points[0].point, this.points[1].point, ab );

            if ( vec3.dot( ab, ao ) < 0 ) {
                // Origin is on the opposite side of A from B
                vec3.set( ao, this.next_direction );
				Goblin.ObjectPool.freeObject( 'GJK2SupportPoint', this.points[1] );
                this.points.length = 1; // Remove second point
			} else {
                // Origin lies between A and B, move on to a 2-simplex
                vec3.cross( ab, ao, this.next_direction );
                vec3.cross( this.next_direction, ab );

                // In the case that `ab` and `ao` are parallel vectors, direction becomes a 0-vector
                if (
                    this.next_direction[0] === 0 &&
                    this.next_direction[1] === 0 &&
                    this.next_direction[2] === 0
                ) {
                    vec3.normalize( ab );
                    this.next_direction[0] = 1 - Math.abs( ab[0] );
                    this.next_direction[1] = 1 - Math.abs( ab[1] );
                    this.next_direction[2] = 1 - Math.abs( ab[2] );
                }
            }
        },

        findDirectionFromTriangle: function() {
            // Triangle
            var a = this.points[2],
                b = this.points[1],
                c = this.points[0];

            vec3.negate( a.point, ao ); // ao
            vec3.subtract( b.point, a.point, ab ); // ab
            vec3.subtract( c.point, a.point, ac ); // ac

            // Determine the triangle's normal
            vec3.cross( ab, ac, _tmp_vec3_1 );

            // Edge cross products
            vec3.cross( ab, _tmp_vec3_1, _tmp_vec3_2 );
            vec3.cross( _tmp_vec3_1, ac, _tmp_vec3_3 );

            if ( vec3.dot( _tmp_vec3_3, ao ) >= 0 ) {
                // Origin lies on side of ac opposite the triangle
                if ( vec3.dot( ac, ao ) >= 0 ) {
                    // Origin outside of the ac line, so we form a new
                    // 1-simplex (line) with points A and C, leaving B behind
                    this.points.length = 0;
                    this.points.push( c, a );
					Goblin.ObjectPool.freeObject( 'GJK2SupportPoint', b );

                    // New search direction is from ac towards the origin
                    vec3.cross( ac, ao, this.next_direction );
                    vec3.cross( this.next_direction, ac );
                } else {
                    // *
                    if ( vec3.dot( ab, ao ) >= 0 ) {
                        // Origin outside of the ab line, so we form a new
                        // 1-simplex (line) with points A and B, leaving C behind
                        this.points.length = 0;
                        this.points.push( b, a );
						Goblin.ObjectPool.freeObject( 'GJK2SupportPoint', c );

                        // New search direction is from ac towards the origin
                        vec3.cross( ab, ao, this.next_direction );
                        vec3.cross( this.next_direction, ab );
                    } else {
                        // only A gives us a good reference point, start over with a 0-simplex
                        this.points.length = 0;
                        this.points.push( a );
						Goblin.ObjectPool.freeObject( 'GJK2SupportPoint', b );
						Goblin.ObjectPool.freeObject( 'GJK2SupportPoint', c );
                    }
                    // *
                }

            } else {

                // Origin lies on the triangle side of ac
                if ( vec3.dot( _tmp_vec3_2, ao ) >= 0 ) {
                    // Origin lies on side of ab opposite the triangle

                    // *
                    if ( vec3.dot( ab, ao ) >= 0 ) {
                        // Origin outside of the ab line, so we form a new
                        // 1-simplex (line) with points A and B, leaving C behind
                        this.points.length = 0;
                        this.points.push( b, a );
						Goblin.ObjectPool.freeObject( 'GJK2SupportPoint', c );

                        // New search direction is from ac towards the origin
                        vec3.cross( ab, ao, this.next_direction );
                        vec3.cross( this.next_direction, ab );
                    } else {
                        // only A gives us a good reference point, start over with a 0-simplex
                        this.points.length = 0;
                        this.points.push( a );
						Goblin.ObjectPool.freeObject( 'GJK2SupportPoint', b );
						Goblin.ObjectPool.freeObject( 'GJK2SupportPoint', c );
                    }
                    // *

                } else {

                    // Origin lies somewhere in the triangle or above/below it
                    if ( vec3.dot( _tmp_vec3_1, ao ) >= 0 ) {
                        // Origin is on the front side of the triangle
                        vec3.set( _tmp_vec3_1, this.next_direction );
						this.points.length = 0;
						this.points.push( a, b, c );
                    } else {
                        // Origin is on the back side of the triangle
                        vec3.set( _tmp_vec3_1, this.next_direction );
                        vec3.negate( this.next_direction );
                    }

                }

            }
        },

        getFaceNormal: function( a, b, c, destination ) {
            vec3.subtract( b.point, a.point, ab );
            vec3.subtract( c.point, a.point, ac );
            vec3.cross( ab, ac, destination );
            vec3.normalize( destination );
        },

        faceNormalDotOrigin: function( a, b, c ) {
            // Find face normal
            this.getFaceNormal( a, b, c, _tmp_vec3_1 );

            // Find direction of origin from center of face
            vec3.add( a.point, b.point, _tmp_vec3_2 );
            vec3.add( _tmp_vec3_2, c.point );
			vec3.scale( _tmp_vec3_2, -3 );
            vec3.normalize( _tmp_vec3_2 );

            return vec3.dot( _tmp_vec3_1, _tmp_vec3_2 );
        },

        findDirectionFromTetrahedron: function() {
            var a = this.points[3],
                b = this.points[2],
                c = this.points[1],
                d = this.points[0];

			// Check each of the four sides to see which one is facing the origin.
			// Then keep the three points for that triangle and use its normal as the search direction
			// The four faces are BCD, ACB, CAD, DAB
			var closest_face = null,
				closest_dot = Goblin.EPSILON,
				face_dot;

			// @TODO we end up calculating the "winning" face normal twice, don't do that

			face_dot = this.faceNormalDotOrigin( b, c, d );
			if ( face_dot > closest_dot ) {
				closest_face = 1;
				closest_dot = face_dot;
			}

			face_dot = this.faceNormalDotOrigin( a, c, b );
			if ( face_dot > closest_dot ) {
				closest_face = 2;
				closest_dot = face_dot;
			}

			face_dot = this.faceNormalDotOrigin( c, a, d );
			if ( face_dot > closest_dot ) {
				closest_face = 3;
				closest_dot = face_dot;
			}

			face_dot = this.faceNormalDotOrigin( d, a, b );
			if ( face_dot > closest_dot ) {
				closest_face = 4;
				closest_dot = face_dot;
			}

			if ( closest_face === null ) {
				// We have a collision, ready for EPA
				//console.log( 'zomg collision found!' );
				return true;
			} else if ( closest_face === 1 ) {
				// BCD
				this.points.length = 0;
				this.points.push( b, c, d );
				this.getFaceNormal( b, c, d, _tmp_vec3_1 );
				vec3.set( _tmp_vec3_1, this.next_direction );
			} else if ( closest_face === 2 ) {
				// ACB
				this.points.length = 0;
				this.points.push( a, c, b );
				this.getFaceNormal( a, c, b, _tmp_vec3_1 );
				vec3.set( _tmp_vec3_1, this.next_direction );
			} else if ( closest_face === 3 ) {
				// CAD
				this.points.length = 0;
				this.points.push( c, a, d );
				this.getFaceNormal( c, a, d, _tmp_vec3_1 );
				vec3.set( _tmp_vec3_1, this.next_direction );
			} else if ( closest_face === 4 ) {
				// DAB
				this.points.length = 0;
				this.points.push( d, a, b );
				this.getFaceNormal( d, a, b, _tmp_vec3_1 );
				vec3.set( _tmp_vec3_1, this.next_direction );
			}

			// @TODO re-enable this based on above results
			//Goblin.ObjectPool.freeObject( 'GJK2SupportPoint', forgotten_point );
        },

        containsOrigin: function() {
			var a = this.points[3],
                b = this.points[2],
                c = this.points[1],
                d = this.points[0];

            // Check DCA
            vec3.subtract( d.point, a.point, ab );
            vec3.subtract( c.point, a.point, ad );
            vec3.cross( ab, ad, _tmp_vec3_1 );
            if ( vec3.dot( _tmp_vec3_1, a.point ) > 0 ) {
                return false;
            }

            // Check CBA
            vec3.subtract( c.point, a.point, ab );
            vec3.subtract( b.point, a.point, ad );
            vec3.cross( ab, ad, _tmp_vec3_1 );
            if ( vec3.dot( _tmp_vec3_1, a.point ) > 0 ) {
                return false;
            }

            // Check ADB
            vec3.subtract( b.point, a.point, ab );
            vec3.subtract( d.point, a.point, ad );
            vec3.cross( ab, ad, _tmp_vec3_1 );
            if ( vec3.dot( _tmp_vec3_1, a.point ) > 0 ) {
                return false;
            }

            // Check DCB
            vec3.subtract( d.point, c.point, ab );
            vec3.subtract( b.point, c.point, ad );
            vec3.cross( ab, ad, _tmp_vec3_1 );
            if ( vec3.dot( _tmp_vec3_1, d.point ) > 0 ) {
                return false;
            }

            return true;
        },

        updateDirection: function() {
            if ( this.points.length === 0 ) {

                vec3.subtract( this.object_b.position, this.object_a.position, this.next_direction );

            } else if ( this.points.length === 1 ) {

                vec3.negate( this.next_direction );

            } else if ( this.points.length === 2 ) {

                this.findDirectionFromLine();

            } else if ( this.points.length === 3 ) {

                this.findDirectionFromTriangle();

            } else {

                return this.findDirectionFromTetrahedron();

            }
        }
    };
})();
