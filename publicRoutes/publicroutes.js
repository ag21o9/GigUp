import { Router } from "express";
import prisma from "../prisma.config.js";
import { setCache, getCache } from "../utils/redis.js";

export const publicRouter = Router();

// GET /api/public/freelancers - Get all freelancer profiles with project details
publicRouter.get('/freelancers', async (req, res) => {
    try {
        const { 
            skills, 
            minRating, 
            location, 
            availability, 
            page = 1, 
            limit = 12 
        } = req.query;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const cacheKey = `public:freelancers:${JSON.stringify(req.query)}`;

        // Check cache
        const cachedData = await getCache(cacheKey);
        if (cachedData) {
            return res.status(200).json({
                success: true,
                data: cachedData
            });
        }

        const whereClause = {};

        // Filter by availability
        if (availability !== undefined) {
            whereClause.availability = availability === 'true';
        }

        // Filter by minimum rating
        if (minRating) {
            whereClause.ratings = { gte: parseFloat(minRating) };
        }

        // Filter by skills
        if (skills) {
            const skillsArray = skills.split(',').map(skill => skill.trim());
            whereClause.skills = {
                hasSome: skillsArray
            };
        }

        // User location filter
        if (location) {
            whereClause.user = {
                location: {
                    contains: location,
                    mode: 'insensitive'
                }
            };
        }

        // Add to whereClause
        whereClause.user = {
            ...whereClause.user,
            isActive: true // Only show active freelancers
        };

        const freelancers = await prisma.freelancer.findMany({
            where: whereClause,
            include: {
                user: {
                    select: {
                        name: true,
                        profileImage: true,
                        bio: true,
                        location: true,
                        createdAt: true
                    }
                },
                assignedProjects: {
                    where: {
                        status: 'COMPLETED'
                    },
                    select: {
                        id: true,
                        title: true,
                        createdAt: true,
                        client: {
                            select: {
                                companyName: true,
                                user: {
                                    select: {
                                        name: true
                                    }
                                }
                            }
                        }
                    },
                    orderBy: {
                        createdAt: 'desc'
                    }
                }
            },
            orderBy: [
                { ratings: 'desc' },
                { projectsCompleted: 'desc' }
            ],
            skip,
            take: parseInt(limit)
        });

        const totalFreelancers = await prisma.freelancer.count({
            where: whereClause
        });

        const responseData = {
            freelancers: freelancers.map(freelancer => ({
                id: freelancer.id,
                profile: {
                    name: freelancer.user.name,
                    profileImage: freelancer.user.profileImage,
                    bio: freelancer.user.bio,
                    location: freelancer.user.location,
                    memberSince: freelancer.user.createdAt
                },
                skills: freelancer.skills,
                experience: freelancer.experience,
                projectsCompleted: freelancer.projectsCompleted,
                ratings: freelancer.ratings,
                hourlyRate: freelancer.hourlyRate,
                availability: freelancer.availability,
                portfolioLinks: {
                    github: freelancer.githubUrl,
                    linkedin: freelancer.linkedinUrl,
                    portfolio: freelancer.portfolioUrl
                },
                completedProjects: freelancer.assignedProjects.map(project => ({
                    title: project.title,
                    completedAt: project.createdAt,
                    client: {
                        name: project.client.user.name,
                        company: project.client.companyName
                    }
                }))
            })),
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: totalFreelancers,
                pages: Math.ceil(totalFreelancers / parseInt(limit))
            }
        };

        // Cache for 10 minutes
        await setCache(cacheKey, responseData, 600);

        res.status(200).json({
            success: true,
            data: responseData
        });

    } catch (error) {
        console.error('Get public freelancers error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// GET /api/public/jobs - Get all available jobs/projects
publicRouter.get('/jobs', async (req, res) => {
    try {
        const { 
            skills, 
            budgetMin, 
            budgetMax, 
            duration,
            page = 1, 
            limit = 12 
        } = req.query;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const cacheKey = `public:jobs:${JSON.stringify(req.query)}`;

        // Check cache
        const cachedData = await getCache(cacheKey);
        if (cachedData) {
            return res.status(200).json({
                success: true,
                data: cachedData
            });
        }

        const whereClause = {
            status: 'OPEN',
            client: {
                user: {
                    isActive: true // Only show projects from active clients
                }
            }
        };

        // Filter by skills
        if (skills) {
            const skillsArray = skills.split(',').map(skill => skill.trim());
            whereClause.skillsRequired = {
                hasSome: skillsArray
            };
        }

        // Filter by budget range
        if (budgetMin) {
            whereClause.budgetMin = { gte: parseFloat(budgetMin) };
        }
        if (budgetMax) {
            whereClause.budgetMax = { lte: parseFloat(budgetMax) };
        }

        // Filter by duration
        if (duration) {
            whereClause.duration = {
                contains: duration,
                mode: 'insensitive'
            };
        }

        const projects = await prisma.project.findMany({
            where: whereClause,
            include: {
                client: {
                    select: {
                        companyName: true,
                        industry: true,
                        ratings: true,
                        user: {
                            select: {
                                name: true,
                                profileImage: true,
                                location: true
                            }
                        }
                    }
                },
                applications: {
                    select: {
                        id: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            },
            skip,
            take: parseInt(limit)
        });

        const totalProjects = await prisma.project.count({
            where: whereClause
        });

        const responseData = {
            jobs: projects.map(project => ({
                id: project.id,
                title: project.title,
                description: project.description,
                skillsRequired: project.skillsRequired,
                budget: {
                    min: project.budgetMin,
                    max: project.budgetMax
                },
                duration: project.duration,
                postedAt: project.createdAt,
                applicationsCount: project.applications.length,
                client: {
                    name: project.client.user.name,
                    company: project.client.companyName,
                    industry: project.client.industry,
                    location: project.client.user.location,
                    profileImage: project.client.user.profileImage,
                    ratings: project.client.ratings
                }
            })),
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: totalProjects,
                pages: Math.ceil(totalProjects / parseInt(limit))
            }
        };

        // Cache for 5 minutes
        await setCache(cacheKey, responseData, 300);

        res.status(200).json({
            success: true,
            data: responseData
        });

    } catch (error) {
        console.error('Get public jobs error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// GET /api/public/featured/projects - Get top 3 featured projects
publicRouter.get('/featured/projects', async (req, res) => {
    try {
        const cacheKey = 'public:featured:projects';

        // Check cache
        const cachedData = await getCache(cacheKey);
        if (cachedData) {
            return res.status(200).json({
                success: true,
                data: cachedData
            });
        }

        // Get projects with most applications (indicating popularity)
        const featuredProjects = await prisma.project.findMany({
            where: {
                status: 'OPEN'
            },
            include: {
                client: {
                    select: {
                        companyName: true,
                        industry: true,
                        ratings: true,
                        user: {
                            select: {
                                name: true,
                                profileImage: true,
                                location: true
                            }
                        }
                    }
                },
                applications: {
                    select: {
                        id: true,
                        freelancer: {
                            select: {
                                ratings: true
                            }
                        }
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            },
            take: 10 // Get more to filter and randomize
        });

        // Sort by applications count and randomize if tied
        const sortedProjects = featuredProjects
            .map(project => ({
                ...project,
                applicationsCount: project.applications.length,
                averageFreelancerRating: project.applications.length > 0 
                    ? project.applications.reduce((sum, app) => sum + app.freelancer.ratings, 0) / project.applications.length 
                    : 0
            }))
            .sort((a, b) => {
                if (b.applicationsCount === a.applicationsCount) {
                    return Math.random() - 0.5; // Random sort if tied
                }
                return b.applicationsCount - a.applicationsCount;
            })
            .slice(0, 3);

        const responseData = sortedProjects.map(project => ({
            id: project.id,
            title: project.title,
            description: project.description,
            skillsRequired: project.skillsRequired,
            budget: {
                min: project.budgetMin,
                max: project.budgetMax
            },
            duration: project.duration,
            postedAt: project.createdAt,
            applicationsCount: project.applicationsCount,
            averageFreelancerRating: project.averageFreelancerRating,
            client: {
                name: project.client.user.name,
                company: project.client.companyName,
                industry: project.client.industry,
                location: project.client.user.location,
                profileImage: project.client.user.profileImage,
                ratings: project.client.ratings
            }
        }));

        // Cache for 15 minutes
        await setCache(cacheKey, responseData, 900);

        res.status(200).json({
            success: true,
            data: responseData
        });

    } catch (error) {
        console.error('Get featured projects error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// GET /api/public/featured/freelancers - Get top 3 featured freelancers
publicRouter.get('/featured/freelancers', async (req, res) => {
    try {
        const cacheKey = 'public:featured:freelancers';

        // Check cache
        const cachedData = await getCache(cacheKey);
        if (cachedData) {
            return res.status(200).json({
                success: true,
                data: cachedData
            });
        }

        // Get freelancers ordered by projects completed and ratings
        const featuredFreelancers = await prisma.freelancer.findMany({
            where: {
                availability: true
            },
            include: {
                user: {
                    select: {
                        name: true,
                        profileImage: true,
                        bio: true,
                        location: true,
                        createdAt: true
                    }
                },
                assignedProjects: {
                    where: {
                        status: 'COMPLETED'
                    },
                    select: {
                        id: true,
                        title: true,
                        createdAt: true,
                        client: {
                            select: {
                                companyName: true,
                                user: {
                                    select: {
                                        name: true
                                    }
                                }
                            }
                        }
                    },
                    orderBy: {
                        createdAt: 'desc'
                    },
                    take: 5 // Show last 5 projects
                }
            },
            orderBy: [
                { projectsCompleted: 'desc' },
                { ratings: 'desc' }
            ],
            take: 10 // Get more to filter and randomize
        });

        // Randomize if tied in projects completed
        const sortedFreelancers = featuredFreelancers
            .sort((a, b) => {
                if (b.projectsCompleted === a.projectsCompleted) {
                    if (b.ratings === a.ratings) {
                        return Math.random() - 0.5; // Random sort if completely tied
                    }
                    return b.ratings - a.ratings;
                }
                return b.projectsCompleted - a.projectsCompleted;
            })
            .slice(0, 3);

        const responseData = sortedFreelancers.map(freelancer => ({
            id: freelancer.id,
            profile: {
                name: freelancer.user.name,
                profileImage: freelancer.user.profileImage,
                bio: freelancer.user.bio,
                location: freelancer.user.location,
                memberSince: freelancer.user.createdAt
            },
            skills: freelancer.skills,
            experience: freelancer.experience,
            projectsCompleted: freelancer.projectsCompleted,
            ratings: freelancer.ratings,
            hourlyRate: freelancer.hourlyRate,
            portfolioLinks: {
                github: freelancer.githubUrl,
                linkedin: freelancer.linkedinUrl,
                portfolio: freelancer.portfolioUrl
            },
            recentProjects: freelancer.assignedProjects.map(project => ({
                title: project.title,
                completedAt: project.createdAt,
                client: {
                    name: project.client.user.name,
                    company: project.client.companyName
                }
            }))
        }));

        // Cache for 15 minutes
        await setCache(cacheKey, responseData, 900);

        res.status(200).json({
            success: true,
            data: responseData
        });

    } catch (error) {
        console.error('Get featured freelancers error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// GET /api/public/stats - Get platform statistics
publicRouter.get('/stats', async (req, res) => {
    try {
        const cacheKey = 'public:platform:stats';

        // Check cache
        const cachedData = await getCache(cacheKey);
        if (cachedData) {
            return res.status(200).json({
                success: true,
                data: cachedData
            });
        }

        const [
            totalFreelancers,
            totalClients,
            totalProjects,
            completedProjects,
            openProjects
        ] = await Promise.all([
            prisma.freelancer.count(),
            prisma.client.count(),
            prisma.project.count(),
            prisma.project.count({ where: { status: 'COMPLETED' } }),
            prisma.project.count({ where: { status: 'OPEN' } })
        ]);

        const responseData = {
            totalFreelancers,
            totalClients,
            totalProjects,
            completedProjects,
            openProjects,
            successRate: totalProjects > 0 ? ((completedProjects / totalProjects) * 100).toFixed(1) : 0
        };

        // Cache for 30 minutes
        await setCache(cacheKey, responseData, 1800);

        res.status(200).json({
            success: true,
            data: responseData
        });

    } catch (error) {
        console.error('Get platform stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// GET /api/public/users/:userId/ratings - Get public ratings for any user (freelancer or client)
publicRouter.get('/users/:userId/ratings', async (req, res) => {
    try {
        const { userId } = req.params;
        const { page = 1, limit = 10 } = req.query;

        // Validate pagination parameters
        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(50, Math.max(1, parseInt(limit))); // Max 50 items per page
        const skip = (pageNum - 1) * limitNum;

        // Create cache key
        const cacheKey = `public:user:${userId}:ratings:page:${pageNum}:limit:${limitNum}`;

        // Check cache first
        const cachedData = await getCache(cacheKey);
        if (cachedData) {
            return res.status(200).json({
                success: true,
                data: cachedData,
                cached: true
            });
        }

        // Check if user exists and get their basic info
        const user = await prisma.user.findUnique({
            where: { 
                id: userId,
                isActive: true // Only show ratings for active users
            },
            select: {
                id: true,
                name: true,
                role: true,
                profileImage: true
            }
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found or account is inactive'
            });
        }

        // Determine rating type based on user role
        let whereClause = {};
        let raterType = '';

        if (user.role === 'FREELANCER') {
            // For freelancers, show ratings received from clients
            whereClause = {
                ratedId: userId,
                raterType: 'CLIENT_TO_FREELANCER'
            };
            raterType = 'CLIENT_TO_FREELANCER';
        } else if (user.role === 'CLIENT') {
            // For clients, show ratings received from freelancers
            whereClause = {
                ratedId: userId,
                raterType: 'FREELANCER_TO_CLIENT'
            };
            raterType = 'FREELANCER_TO_CLIENT';
        } else {
            return res.status(400).json({
                success: false,
                message: 'Invalid user role for ratings'
            });
        }

        // Get ratings, total count, and statistics in parallel
        const [ratings, totalRatings, avgRatingData, ratingDistribution] = await Promise.all([
            // Get paginated ratings
            prisma.rating.findMany({
                where: whereClause,
                select: {
                    id: true,
                    rating: true,
                    review: true,
                    createdAt: true,
                    project: {
                        select: {
                            title: true
                        }
                    }
                },
                orderBy: {
                    createdAt: 'desc'
                },
                skip,
                take: limitNum
            }),
            
            // Get total count
            prisma.rating.count({ 
                where: whereClause 
            }),
            
            // Get average rating
            prisma.rating.aggregate({
                where: whereClause,
                _avg: {
                    rating: true
                },
                _count: {
                    rating: true
                }
            }),
            
            // Get rating distribution
            prisma.rating.groupBy({
                by: ['rating'],
                where: whereClause,
                _count: {
                    rating: true
                }
            })
        ]);

        // Format ratings (remove rater information for privacy)
        const formattedRatings = ratings.map(rating => ({
            id: rating.id,
            rating: rating.rating,
            review: rating.review,
            project: {
                title: rating.project.title
            },
            createdAt: rating.createdAt
        }));

        // Create rating distribution object
        const distribution = {
            1: 0,
            2: 0,
            3: 0,
            4: 0,
            5: 0
        };

        ratingDistribution.forEach(item => {
            distribution[item.rating] = item._count.rating;
        });

        // Calculate additional statistics
        const averageRating = avgRatingData._avg.rating ? parseFloat(avgRatingData._avg.rating.toFixed(2)) : 0;
        const totalRatingsCount = avgRatingData._count.rating;

        // Calculate percentage for each rating
        const distributionWithPercentage = {};
        Object.keys(distribution).forEach(star => {
            const count = distribution[star];
            const percentage = totalRatingsCount > 0 ? ((count / totalRatingsCount) * 100).toFixed(1) : 0;
            distributionWithPercentage[star] = {
                count,
                percentage: parseFloat(percentage)
            };
        });

        const responseData = {
            user: {
                id: user.id,
                name: user.name,
                role: user.role,
                profileImage: user.profileImage
            },
            ratings: formattedRatings,
            statistics: {
                averageRating,
                totalRatings: totalRatingsCount,
                distribution: distributionWithPercentage,
                ratingBreakdown: {
                    excellent: distribution[5], // 5 star
                    good: distribution[4],      // 4 star
                    average: distribution[3],   // 3 star
                    poor: distribution[2],      // 2 star
                    terrible: distribution[1]   // 1 star
                }
            },
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: totalRatings,
                pages: Math.ceil(totalRatings / limitNum),
                hasNext: pageNum * limitNum < totalRatings,
                hasPrev: pageNum > 1
            }
        };

        // Cache for 20 minutes (public data, less frequent updates)
        await setCache(cacheKey, responseData, 1200);

        res.status(200).json({
            success: true,
            data: responseData
        });

    } catch (error) {
        console.error('Get public user ratings error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// GET /api/public/users/:userId/ratings/summary - Get condensed rating summary
publicRouter.get('/users/:userId/ratings/summary', async (req, res) => {
    try {
        const { userId } = req.params;
        const cacheKey = `public:user:${userId}:ratings:summary`;

        // Check cache first
        const cachedData = await getCache(cacheKey);
        if (cachedData) {
            return res.status(200).json({
                success: true,
                data: cachedData,
                cached: true
            });
        }

        // Check if user exists
        const user = await prisma.user.findUnique({
            where: { 
                id: userId,
                isActive: true
            },
            select: {
                id: true,
                name: true,
                role: true,
                profileImage: true
            }
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found or account is inactive'
            });
        }

        // Determine rating type based on user role
        let whereClause = {};
        if (user.role === 'FREELANCER') {
            whereClause = {
                ratedId: userId,
                raterType: 'CLIENT_TO_FREELANCER'
            };
        } else if (user.role === 'CLIENT') {
            whereClause = {
                ratedId: userId,
                raterType: 'FREELANCER_TO_CLIENT'
            };
        } else {
            return res.status(400).json({
                success: false,
                message: 'Invalid user role for ratings'
            });
        }

        // Get rating statistics and recent ratings
        const [avgRatingData, ratingDistribution, recentRatings] = await Promise.all([
            prisma.rating.aggregate({
                where: whereClause,
                _avg: {
                    rating: true
                },
                _count: {
                    rating: true
                }
            }),
            
            prisma.rating.groupBy({
                by: ['rating'],
                where: whereClause,
                _count: {
                    rating: true
                }
            }),

            // Get 3 most recent ratings
            prisma.rating.findMany({
                where: whereClause,
                select: {
                    rating: true,
                    review: true,
                    createdAt: true,
                    project: {
                        select: {
                            title: true
                        }
                    }
                },
                orderBy: {
                    createdAt: 'desc'
                },
                take: 3
            })
        ]);

        // Create rating distribution
        const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        ratingDistribution.forEach(item => {
            distribution[item.rating] = item._count.rating;
        });

        const averageRating = avgRatingData._avg.rating ? parseFloat(avgRatingData._avg.rating.toFixed(2)) : 0;
        const totalRatings = avgRatingData._count.rating;

        const responseData = {
            user: {
                id: user.id,
                name: user.name,
                role: user.role,
                profileImage: user.profileImage
            },
            summary: {
                averageRating,
                totalRatings,
                starDistribution: distribution,
                recentRatings: recentRatings.map(rating => ({
                    rating: rating.rating,
                    review: rating.review ? rating.review.substring(0, 100) + (rating.review.length > 100 ? '...' : '') : null,
                    projectTitle: rating.project.title,
                    createdAt: rating.createdAt
                }))
            }
        };

        // Cache for 30 minutes (summary data)
        await setCache(cacheKey, responseData, 1800);

        res.status(200).json({
            success: true,
            data: responseData
        });

    } catch (error) {
        console.error('Get user ratings summary error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});