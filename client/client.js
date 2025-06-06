import { Router } from "express";
import multer from "multer";

import prisma from "../prisma.config.js";
import {
    signup,
    login,
    updateProfile,
    getProfile,
    getAllFreelancers
} from "./auth.js";
import { authenticateToken } from "../middleware/auth.js";

export const clientRouter = Router();


// Configure multer for file uploads (profile images)
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'), false);
        }
    }
});

// Authentication Routes (Public)
clientRouter.post('/signup', upload.single('profileImage'), signup);
clientRouter.post('/login', login);

// Profile Management Routes (Protected)
clientRouter.get('/profile', authenticateToken, getProfile);
clientRouter.put('/profile', authenticateToken, upload.single('profileImage'), updateProfile);

// Freelancer Management Routes (Protected)
clientRouter.get('/freelancers', authenticateToken, getAllFreelancers);

// Project Management Routes (Protected)
// POST /api/client/projects - Create a new project
clientRouter.post('/projects', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const {
            title,
            description,
            skillsRequired,
            budgetMin,
            budgetMax,
            duration
        } = req.body;

        // Validation
        if (!title) {
            return res.status(400).json({
                success: false,
                message: 'Project title is required'
            });
        }

        // Check if user is a client
        const client = await prisma.client.findUnique({
            where: { userId }
        });

        if (!client) {
            return res.status(404).json({
                success: false,
                message: 'Client not found'
            });
        }

        // Create project
        const project = await prisma.project.create({
            data: {
                title,
                description,
                clientId: client.id,
                skillsRequired: skillsRequired ? skillsRequired.split(',').map(skill => skill.trim()) : [],
                budgetMin: budgetMin ? parseFloat(budgetMin) : null,
                budgetMax: budgetMax ? parseFloat(budgetMax) : null,
                duration
            },
            include: {
                client: {
                    include: {
                        user: {
                            select: {
                                name: true,
                                profileImage: true
                            }
                        }
                    }
                }
            }
        });

        // Update client's projects posted count
        await prisma.client.update({
            where: { id: client.id },
            data: {
                projectsPosted: {
                    increment: 1
                }
            }
        });

        res.status(201).json({
            success: true,
            message: 'Project created successfully',
            data: project
        });

    } catch (error) {
        console.error('Create project error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// GET /api/client/projects - Get client's posted projects
clientRouter.get('/projects', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { status, page = 1, limit = 10 } = req.query;
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const client = await prisma.client.findUnique({
            where: { userId }
        });

        if (!client) {
            return res.status(404).json({
                success: false,
                message: 'Client not found'
            });
        }

        const whereClause = {
            clientId: client.id
        };

        if (status) {
            whereClause.status = status.toUpperCase();
        }

        const projects = await prisma.project.findMany({
            where: whereClause,
            include: {
                freelancer: {
                    include: {
                        user: {
                            select: {
                                name: true,
                                email: true,
                                profileImage: true
                            }
                        }
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

        res.status(200).json({
            success: true,
            data: {
                projects,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: totalProjects,
                    pages: Math.ceil(totalProjects / parseInt(limit))
                }
            }
        });

    } catch (error) {
        console.error('Get projects error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// PUT /api/client/projects/:projectId/assign/:freelancerId - Assign project to freelancer
clientRouter.put('/projects/:projectId/assign/:freelancerId', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { projectId, freelancerId } = req.params;

        // Check if user is a client
        const client = await prisma.client.findUnique({
            where: { userId }
        });

        if (!client) {
            return res.status(404).json({
                success: false,
                message: 'Client not found'
            });
        }

        // Check if project exists and belongs to this client
        const project = await prisma.project.findFirst({
            where: {
                id: projectId,
                clientId: client.id
            }
        });

        if (!project) {
            return res.status(404).json({
                success: false,
                message: 'Project not found or you do not have permission to modify it'
            });
        }

        if (project.status !== 'OPEN') {
            return res.status(400).json({
                success: false,
                message: 'Project is not available for assignment'
            });
        }

        // Check if freelancer exists
        const freelancer = await prisma.freelancer.findUnique({
            where: { id: freelancerId },
            include: {
                user: {
                    select: {
                        name: true,
                        email: true,
                        profileImage: true
                    }
                }
            }
        });

        if (!freelancer) {
            return res.status(404).json({
                success: false,
                message: 'Freelancer not found'
            });
        }

        // Assign project to freelancer
        const updatedProject = await prisma.project.update({
            where: { id: projectId },
            data: {
                assignedTo: freelancerId,
                status: 'ASSIGNED'
            },
            include: {
                freelancer: {
                    include: {
                        user: {
                            select: {
                                name: true,
                                email: true,
                                profileImage: true
                            }
                        }
                    }
                },
                client: {
                    include: {
                        user: {
                            select: {
                                name: true,
                                profileImage: true
                            }
                        }
                    }
                }
            }
        });

        res.status(200).json({
            success: true,
            message: 'Project assigned successfully',
            data: updatedProject
        });

    } catch (error) {
        console.error('Assign project error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// GET /api/client/dashboard - Get client dashboard data
clientRouter.get('/dashboard', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        
        const client = await prisma.client.findUnique({
            where: { userId },
            include: {
                user: {
                    select: {
                        name: true,
                        email: true,
                        profileImage: true
                    }
                },
                projects: {
                    include: {
                        freelancer: {
                            include: {
                                user: {
                                    select: {
                                        name: true,
                                        profileImage: true
                                    }
                                }
                            }
                        }
                    },
                    orderBy: {
                        createdAt: 'desc'
                    }
                }
            }
        });

        if (!client) {
            return res.status(404).json({
                success: false,
                message: 'Client not found'
            });
        }

        const stats = {
            totalProjects: client.projectsPosted,
            openProjects: client.projects.filter(p => p.status === 'OPEN').length,
            assignedProjects: client.projects.filter(p => p.status === 'ASSIGNED').length,
            completedProjects: client.projects.filter(p => p.status === 'COMPLETED').length,
            rating: client.ratings
        };

        res.status(200).json({
            success: true,
            data: {
                client,
                stats
            }
        });

    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// Error handling middleware for multer
clientRouter.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: 'File size too large. Maximum size is 5MB.'
            });
        }
    }
    
    if (error.message === 'Only image files are allowed') {
        return res.status(400).json({
            success: false,
            message: 'Only image files are allowed for profile pictures.'
        });
    }
    
    next(error);
});


